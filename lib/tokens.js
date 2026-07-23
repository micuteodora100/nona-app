import { getSupabaseServer } from "./supabase-server"
import { encrypt, decrypt } from "./crypto"

// Access/refresh tokens live here, keyed by (userId, provider) — never in the
// NextAuth session JWT. Google's + Microsoft's tokens combined comfortably
// exceed the browser's 4096-byte cookie limit, which used to make the second
// provider's cookie write silently fail and look like "connecting Outlook
// disconnects Gmail" (or vice versa). The session now only carries a tiny
// {connected, email} marker per provider; the actual tokens are fetched here.

const REFRESH_MARGIN_MS = 5 * 60 * 1000 // refresh if less than 5 min of life left

async function saveTokens(userId, provider, { accessToken, refreshToken, expiresAt }) {
  const supabase = getSupabaseServer()
  if (!supabase) return
  const row = {
    user_id: userId,
    provider,
    updated_at: new Date().toISOString(),
  }
  if (accessToken) row.encrypted_access_token = encrypt(accessToken)
  if (expiresAt) row.expires_at = new Date(expiresAt * 1000).toISOString()
  // Google only issues a refresh_token on first consent — don't overwrite a
  // previously stored one with null on later token refreshes.
  if (refreshToken) row.encrypted_refresh_token = encrypt(refreshToken)

  await supabase.from("oauth_tokens").upsert(row, { onConflict: "user_id,provider" })
}

async function loadTokenRow(userId, provider) {
  const supabase = getSupabaseServer()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("user_id", userId)
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
  const res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "openid profile email offline_access https://graph.microsoft.com/Mail.Read",
    }),
  })
  if (!res.ok) throw new Error(`Microsoft token refresh failed: ${res.status}`)
  const data = await res.json()
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in }
}

// Persists the tokens NextAuth received at sign-in. Called from the jwt()
// callback right after OAuth completes.
export async function persistProviderTokens(userId, provider, { accessToken, refreshToken, expiresAt }) {
  await saveTokens(userId, provider, { accessToken, refreshToken, expiresAt })
}

// Returns a live access token for userId+provider, transparently refreshing
// it via the stored refresh token when the cached one is missing or expiring
// soon. Returns null if the user never connected this provider.
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
