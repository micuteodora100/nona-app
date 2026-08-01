import { getToken, encode } from "next-auth/jwt"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { getSupabaseUserReadOnly } from "../../../lib/supabase-auth"
import { revokeProviderToken } from "../../../lib/tokens"

// NextAuth (JWT strategy, no adapter) has no built-in "sign out of just one
// provider" — signOut() always clears the whole session. To disconnect only
// Gmail or only Outlook while staying signed in with the other, we decode the
// current session ourselves, drop that provider's entry, and re-encode +
// rewrite the session cookie directly. Cookie name/options mirror NextAuth's
// own defaults (node_modules/next-auth/core/lib/cookie.js) since there's no
// public API to look them up.
const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60 // NextAuth's default session maxAge

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const { provider } = req.body || {}
  if (!provider || !["google", "microsoft"].includes(provider)) {
    return res.status(400).json({ error: "Invalid provider" })
  }

  // Whether a provider is "connected" is decided from oauth_tokens (the same
  // source pages/api/auth/provider-status.js reads) — never from the NextAuth
  // session cookie. That cookie is per-browser and only gets a provider
  // marker at the moment you click "Connect" *in that browser*; disconnecting
  // from a second device, or after the cookie's own 30-day life reset it,
  // used to fail with a false "Provider not connected" here even though the
  // token genuinely existed server-side — the same class of bug the identity
  // migration fixed for the read path, just never carried over to this one.
  // Read-only variant, but `res` is passed so a Supabase session refresh
  // triggered here isn't thrown away (see lib/supabase-auth.js — discarding it
  // burns a rotated refresh token and can sign her out). Both this handler's
  // own NextAuth cookie write below and the Supabase one append to Set-Cookie
  // rather than replacing it, so the two coexist on this response.
  const user = await getSupabaseUserReadOnly(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  const { data: existingRow } = supabase
    ? await supabase.from("oauth_tokens").select("provider").eq("auth_user_id", user.id).eq("provider", provider).single()
    : { data: null }
  if (!existingRow) {
    return res.status(400).json({ error: "Provider not connected" })
  }

  // Revoke upstream + delete our stored copy, keyed by the Supabase Auth
  // identity (not the provider's own email — see lib/tokens.js).
  try {
    await revokeProviderToken(user.id, provider)
    if (supabase) {
      await supabase.from("oauth_tokens").delete().eq("auth_user_id", user.id).eq("provider", provider)
    }
  } catch (err) {
    console.error("Failed to revoke/delete stored tokens on disconnect:", err.message)
  }

  // Best-effort: keep this browser's NextAuth session cookie in sync too, if
  // it exists. Not the source of truth (the DB delete above already is), so a
  // missing/stale cookie here is never treated as an error.
  let nextProviders = {}
  try {
    const secret = process.env.NEXTAUTH_SECRET
    const token = await getToken({ req, secret })
    if (token?.providers) {
      nextProviders = { ...token.providers }
      delete nextProviders[provider]
      const nextToken = { ...token, providers: nextProviders }

      const secureCookie = process.env.NEXTAUTH_URL?.startsWith("https://") ?? !!process.env.VERCEL
      const cookieName = secureCookie ? "__Secure-next-auth.session-token" : "next-auth.session-token"

      const encoded = await encode({ token: nextToken, secret, maxAge: DEFAULT_MAX_AGE })
      const attrs = [
        `${cookieName}=${encoded}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${DEFAULT_MAX_AGE}`,
      ]
      if (secureCookie) attrs.push("Secure")
      // Append, never replace — getSupabaseUserReadOnly above may already have
      // written a refreshed Supabase session cookie onto this same response.
      const existing = res.getHeader("Set-Cookie")
      const header = existing == null ? [] : Array.isArray(existing) ? [...existing] : [existing]
      header.push(attrs.join("; "))
      res.setHeader("Set-Cookie", header)
    }
  } catch (err) {
    console.error("Failed to sync NextAuth session cookie on disconnect (non-fatal):", err.message)
  }

  return res.json({ ok: true, providers: nextProviders })
}
