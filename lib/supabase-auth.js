import { createServerClient, serializeCookieHeader } from "@supabase/ssr"

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
      setAll: (cookiesToSet) => {
        res.setHeader(
          "Set-Cookie",
          cookiesToSet.map(({ name, value, options }) => serializeCookieHeader(name, value, options))
        )
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Read-only variant for contexts where writing Set-Cookie back onto the
// response would risk clobbering headers another handler is also writing
// (e.g. NextAuth's own jwt callback, which runs mid-OAuth-callback while
// NextAuth is writing its own session cookie onto the same response). Misses
// a Supabase session-cookie refresh in the rare case one was due — harmless,
// self-heals on the next normal page load.
export async function getSupabaseUserReadOnly(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => Object.entries(req.cookies || {}).map(([name, value]) => ({ name, value })),
      setAll: () => {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  return user
}
