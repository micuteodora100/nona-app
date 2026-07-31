import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

// NextAuth's OAuth state/PKCE cookies are host-only (it sets no Domain
// attribute), while the callback URL it hands Google/Microsoft is built from
// NEXTAUTH_URL. So starting a connect on the apex domain while NEXTAUTH_URL
// points at www (or the reverse) sends the callback to the *other* host, where
// the state cookie isn't sent at all — the connection then dies with "State
// cookie was missing.", surfacing as a bare OAuthCallback error with no clue as
// to why. Sending every request to the canonical host up front makes that
// impossible no matter which address someone typed or was sent.
//
// Deliberately narrow: only the www/apex pair of the configured host, so
// preview deployments (*.vercel.app) and localhost are left completely alone.
// The domain itself is never hardcoded — it comes from NEXTAUTH_URL, the same
// value the OAuth callback URLs are built from, so the two can't drift apart.
function canonicalHostRedirect(req) {
  if (!process.env.NEXTAUTH_URL) return null
  let canonical
  try {
    canonical = new URL(process.env.NEXTAUTH_URL)
  } catch {
    return null
  }
  // The Host header, not req.nextUrl.host — the latter is the URL Next itself
  // resolved (localhost in dev) rather than the host the browser actually asked
  // for, which is the one that decides where cookies live.
  const host = (req.headers.get("host") || req.nextUrl.host || "").toLowerCase()
  const canonicalHost = canonical.host.toLowerCase()
  if (!host || host === canonicalHost) return null

  const bare = (h) => h.replace(/^www\./, "")
  // Anything that isn't the same site with/without "www" (previews, localhost,
  // custom hosts) is none of this function's business.
  if (bare(host) !== bare(canonicalHost)) return null

  // Built from the canonical origin rather than by mutating the incoming URL,
  // so the scheme and host both come from the one value the OAuth callback URLs
  // are also derived from. Path and query carry over; a fragment never reaches
  // the server in the first place.
  const target = new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, canonical.origin)
  return NextResponse.redirect(target, 308)
}

export async function middleware(req) {
  const { pathname } = req.nextUrl

  const canonical = canonicalHostRedirect(req)
  if (canonical) return canonical

  // The public marketing landing page — exact match only, so this doesn't
  // accidentally allow every path through (everything starts with "/").
  if (pathname === "/") {
    return NextResponse.next()
  }

  // Always allow these paths
  const allowList = [
    "/login",
    // A failed mailbox connect has to be able to explain itself even when the
    // reason it failed is that the app session went away mid-flow — bouncing
    // to /login here would throw away the error code with it.
    "/auth-error",
    "/about",
    "/privacy",
    "/terms",
    "/contact",
    "/unsubscribe",
    "/api/auth",
    "/api/mailing-list",
    "/api/contact",
    "/_next",
    "/favicon.ico",
    "/manifest.json",
    "/icon-192.png",
    "/icon-512.png",
  ]

  if (allowList.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Check Supabase session — the only way into /app now that the legacy
  // shared-password gate has been retired (multi-user identity migration).
  // The old version just checked for the presence of a "sb-*-auth-token"
  // cookie by name — but createBrowserClient (lib/supabase.js) stores the
  // session as an HttpOnly-less cookie whose value alone doesn't prove it's
  // still valid (expired/tampered cookies have the same name). Using
  // createServerClient + auth.getUser() actually validates the session
  // against Supabase and transparently refreshes it when it's close to
  // expiring, rewriting the response cookies via setAll below.
  const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (hasSupabase) {
    let response = NextResponse.next()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
            response = NextResponse.next({ request: req })
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          },
        },
      }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return response
  }

  // Not authenticated — redirect to login
  const url = req.nextUrl.clone()
  url.pathname = "/login"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
