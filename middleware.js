import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Edge-compatible HMAC using Web Crypto API
async function verifyAppPassword(token, secret) {
  if (!token) return false
  const [value, sig] = token.split(".")
  if (!value || !sig) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const expected = await crypto.subtle.sign("HMAC", key, enc.encode(value))
  const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, "0")).join("")
  return expectedHex === sig && value === "authenticated"
}

export async function middleware(req) {
  const { pathname } = req.nextUrl

  // Always allow these paths
  const allowList = [
    "/gate",
    "/login",
    "/api/auth-gate",
    "/api/auth",
    "/_next",
    "/favicon.ico",
    "/manifest.json",
    "/icon-192.png",
    "/icon-512.png",
  ]

  if (allowList.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const secret = process.env.NEXTAUTH_SECRET || "fallback-secret"

  // Check APP_PASSWORD cookie (legacy gate — still works)
  const appPasswordCookie = req.cookies.get("nona_auth")?.value
  if (await verifyAppPassword(appPasswordCookie, secret)) {
    return NextResponse.next()
  }

  // Check Supabase session (new proper auth)
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
  // Try Supabase login first if configured, else fall back to password gate
  const url = req.nextUrl.clone()
  url.pathname = hasSupabase ? "/login" : "/gate"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
