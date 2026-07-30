import { getSupabaseServer } from "./supabase-server"
import { encrypt, decrypt } from "./crypto"

// Access/refresh tokens live here, keyed by (userId, provider) — never in the
// NextAuth session JWT. Google's + Microsoft's tokens combined comfortably
// exceed the browser's 4096-byte cookie limit, which used to make the second
// provider's cookie write silently fail and look like "connecting Outlook
// disconnects Gmail" (or vice versa). The session now only carries a tiny
// {connected, email} marker per provider; the actual tokens are fetched here.

const REFRESH_MARGIN_MS = 5 * 60 * 1000 // refresh if less than 5 min of life left

// userId here is always the Supabase Auth UUID (auth_user_id) — never the
// provider's own email. accountEmail is stored separately purely for display
// ("connected as x@gmail.com"), it is never used to look anything up.
async function saveTokens(userId, provider, { accessToken, refreshToken, expiresAt, accountEmail }) {
  const supabase = getSupabaseServer()
  if (!supabase) return
  const row = {
    auth_user_id: userId,
    provider,
    updated_at: new Date().toISOString(),
  }
  if (accountEmail) row.user_id = accountEmail
  if (accessToken) row.encrypted_access_token = encrypt(accessToken)
  if (expiresAt) row.expires_at = new Date(expiresAt * 1000).toISOString()
  // Google only issues a refresh_token on first consent — don't overwrite a
  // previously stored one with null on later token refreshes.
  if (refreshToken) row.encrypted_refresh_token = encrypt(refreshToken)

  const { error } = await supabase.from("oauth_tokens").upsert(row, { onConflict: "auth_user_id,provider" })
  if (error) console.error(`oauth_tokens upsert failed for ${provider}:`, error.message, error.details || "")
}

async function loadTokenRow(userId, provider) {
  const supabase = getSupabaseServer()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("auth_user_id", userId)
    .eq("provider", provider)
    .single()
  if (error || !data) return null
  return data
}

async function refreshGoogleAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`)
  const data = await res.json()
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

async function refreshMicrosoftAccessToken(refreshToken) {
  // Deliberately no "scope" param: Microsoft's refresh grant returns tokens
  // for whatever scope the original consent covered when omitted. An explicit
  // scope here has to be a *subset* of that original consent, or the whole
  // refresh is rejected (AADSTS70000) — which meant every time a new scope
  // (e.g. Notes.Read) was added to the app registration, every token issued
  // before that change broke permanently on its next refresh, with no way to
  // recover except the user manually reconnecting. Omitting scope avoids that
  // entirely and still returns the originally-granted scopes.
  const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error(`Microsoft token refresh failed: ${res.status}`)
  const data = await res.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in }
}

// Persists the tokens NextAuth received at sign-in. Called from the jwt()
// callback right after OAuth completes. userId is the Supabase Auth UUID of
// whoever is currently logged into the app — never the provider's own email.
export async function persistProviderTokens(userId, provider, { accessToken, refreshToken, expiresAt, accountEmail }) {
  await saveTokens(userId, provider, { accessToken, refreshToken, expiresAt, accountEmail })
}

// Returns a live access token for userId (Supabase Auth UUID) + provider,
// transparently refreshing it via the stored refresh token when the cached
// one is missing or expiring soon. Returns null if the user never connected
// this provider.
export async function getAccessToken(userId, provider) {
  const row = await loadTokenRow(userId, provider)
  if (!row) return null

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0
  if (row.encrypted_access_token && expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return decrypt(row.encrypted_access_token)
  }

  if (!row.encrypted_refresh_token) return null
  const refreshToken = decrypt(row.encrypted_refresh_token)
  const nowSeconds = Math.floor(Date.now() / 1000)

  if (provider === "google") {
    const { accessToken, expiresIn } = await refreshGoogleAccessToken(refreshToken)
    await saveTokens(userId, provider, { accessToken, expiresAt: nowSeconds + expiresIn })
    return accessToken
  }
  if (provider === "microsoft") {
    const { accessToken, refreshToken: newRefreshToken, expiresIn } = await refreshMicrosoftAccessToken(refreshToken)
    await saveTokens(userId, provider, {
      accessToken,
      refreshToken: newRefreshToken || refreshToken,
      expiresAt: nowSeconds + expiresIn,
    })
    return accessToken
  }
  return null
}

// Revokes the stored token with the provider itself, not just our local copy
// — a real person's Gmail/Outlook access is on the line here, so "disconnect"
// should mean Google/Microsoft actually forget this app, not just that we
// stop calling it. Best-effort: never throws, since a failed revoke shouldn't
// block the local disconnect the user asked for.
export async function revokeProviderToken(userId, provider) {
  const row = await loadTokenRow(userId, provider)
  if (!row) return

  try {
    if (provider === "google") {
      const token = row.encrypted_refresh_token
        ? decrypt(row.encrypted_refresh_token)
        : row.encrypted_access_token ? decrypt(row.encrypted_access_token) : null
      if (!token) return
      const res = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
      if (!res.ok) console.error(`Google token revoke failed: ${res.status}`)
    }
    // Microsoft's /consumers (personal account) endpoint has no public
    // programmatic revoke — the closest equivalent is the user removing this
    // app's consent themselves at account.live.com/consent. We still delete
    // our own stored copy either way (see disconnect-provider.js).
  } catch (err) {
    console.error(`Failed to revoke ${provider} token upstream:`, err.message)
  }
}
