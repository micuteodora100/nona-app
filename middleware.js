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
