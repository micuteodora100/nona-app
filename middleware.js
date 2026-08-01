import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function middleware(req) {
  const { pathname } = req.nextUrl

  // The public marketing landing page — exact match only, so this doesn't
  // accidentally allow every path through (everything starts with "/").
  if (pathname === "/") {
    return NextResponse.next()
  }

  // Always allow these paths
  const allowList = [
    "/login",
    "/about",
    "/privacy",
    "/terms",
    "/contact",
    "/unsubscribe",
    "/api/auth",
    "/api/mailing-list",
    "/api/contact",
    // Vercel Cron invokes this with `Authorization: Bearer $CRON_SECRET` and
    // no session cookie — the route authenticates itself (see the CRON_SECRET
    // check at the top of pages/api/cron/morning-brief.js) and must never be
    // reachable without it. Before this entry the redirect below intercepted
    // every scheduled run with a 307 to /login, so the handler never ran and
    // the morning brief silently never sent.
    "/api/cron",
    // Registered by lib/push-client.js from inside the logged-in app, but the
    // browser also re-fetches it periodically to check for updates. Answering
    // that with a redirect to an HTML page fails the update with a bad MIME
    // type and can unregister the worker.
    "/sw.js",
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

  // Not authenticated. API routes get a real 401 rather than the redirect a
  // page gets: following a redirect to /login yields 200 text/html, so every
  // caller doing `if (r.ok)` treated the login page as a successful response
  // and then threw a SyntaxError on r.json(). That surfaced as the app
  // quietly reporting "no providers connected" and sync failing in silence,
  // instead of sending her back to sign in.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = "/login"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
