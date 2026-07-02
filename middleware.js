import { NextResponse } from "next/server"

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

  // Check Supabase session cookie (new proper auth)
  // Supabase stores session in sb-{project-ref}-auth-token cookie
  const supabaseCookies = [...req.cookies.getAll()].filter(c => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"))
  if (supabaseCookies.length > 0) {
    return NextResponse.next()
  }

  // Not authenticated — redirect to login
  // Try Supabase login first if configured, else fall back to password gate
  const hasSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  const url = req.nextUrl.clone()
  url.pathname = hasSupabase ? "/login" : "/gate"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
