import { getToken, encode } from "next-auth/jwt"
import { getSupabaseServer } from "../../../lib/supabase-server"

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

  const secret = process.env.NEXTAUTH_SECRET
  const token = await getToken({ req, secret })
  if (!token || !token.providers?.[provider]) {
    return res.status(400).json({ error: "Provider not connected" })
  }

  const providerEmail = token.providers[provider].email
  const nextProviders = { ...token.providers }
  delete nextProviders[provider]
  const nextToken = { ...token, providers: nextProviders }

  // Best-effort cleanup of the stored access/refresh token for this provider
  // — not required for the session fix itself, but leaves no orphaned
  // credential behind once the UI says "not connected".
  try {
    const supabase = getSupabaseServer()
    if (supabase && providerEmail) {
      await supabase.from("oauth_tokens").delete().eq("user_id", providerEmail).eq("provider", provider)
    }
  } catch (err) {
    console.error("Failed to delete stored tokens on disconnect:", err.message)
  }

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
  res.setHeader("Set-Cookie", attrs.join("; "))

  return res.json({ ok: true, providers: nextProviders })
}
