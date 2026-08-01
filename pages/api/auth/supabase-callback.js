// Fallback landing spot for Supabase auth emails (magic link, signup
// confirmation) in case the dashboard's Site URL or Redirect URLs still point
// here rather than at /login.
//
// The PKCE code exchange happens in the browser — the code verifier lives in a
// cookie that only @supabase/ssr's browser client knows how to pair with the
// ?code= parameter, and only on a page that actually mounts that client. So
// this route's only job is to hand the query string on to /login intact, which
// does mount it (see the effect at the top of pages/login.js).
//
// It previously did `res.redirect(302, "/app")`, dropping the query string
// entirely — the code was discarded, no session was ever created, and
// middleware.js bounced the request straight back to /login as a stranger.
export default async function handler(req, res) {
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""
  res.redirect(302, `/login${query}`)
}
