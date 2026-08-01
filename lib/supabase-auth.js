import { createServerClient, serializeCookieHeader } from "@supabase/ssr"

// Adds to the response's Set-Cookie header instead of replacing it. Node's
// res.setHeader() overwrites, so a plain setHeader("Set-Cookie", …) here
// silently destroyed any cookie another part of the same request had already
// written (and vice versa). Reading the current value and pushing onto it is
// the same approach next-auth itself uses (node_modules/next-auth/next/utils.js),
// which is what makes it safe for both to write on one response.
function appendSetCookie(res, cookiesToSet) {
  if (!res || !cookiesToSet?.length) return
  const existing = res.getHeader("Set-Cookie")
  const header = existing == null ? [] : Array.isArray(existing) ? [...existing] : [existing]
  for (const { name, value, options } of cookiesToSet) {
    header.push(serializeCookieHeader(name, value, options))
  }
  res.setHeader("Set-Cookie", header)
}

// Node/Pages-API-compatible version of the identity check middleware.js already
// does at the edge. This is the one place API routes should ask "who is
// actually logged in" — Supabase Auth's user.id (UUID) is the real identity;
// NextAuth/OAuth is only ever used to obtain Gmail/Outlook access tokens, never
// to answer this question (see ROADMAP.md's multi-user identity migration).
export async function getSupabaseUser(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => appendSetCookie(res, cookiesToSet),
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Variant for handlers that write their own cookies onto the same response
// (e.g. NextAuth's jwt callback, which runs mid-OAuth-callback while NextAuth
// is writing its own session cookie). It used to discard Supabase's cookie
// writes entirely, on the assumption that a missed refresh was harmless. It
// isn't: Supabase rotates refresh tokens, so the refresh that getUser()
// triggers here consumes the browser's copy server-side. Dropping the
// replacement leaves the browser holding a spent token, and once past the
// short reuse-grace window that's a real sign-out — landing precisely on
// "connecting Gmail logged me out of Nona". Passing `res` now appends the
// refreshed cookies rather than dropping them; the append is what keeps it
// from clobbering the handler's own writes.
export async function getSupabaseUserReadOnly(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => appendSetCookie(res, cookiesToSet),
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  return user
}
