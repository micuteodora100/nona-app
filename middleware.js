import { NextResponse } from "next/server"

// Edge-compatible HMAC using Web Crypto API (Node's `crypto` module doesn't work in middleware)
async function sign(value, secret) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")
}

async function verify(token, secret) {
  if (!token) return false
  const [value, sig] = token.split(".")
  if (!value || !sig) return false
  const expected = await sign(value, secret)
  return sig === expected && value === "authenticated"
}

export async function middleware(req) {
  const { pathname } = req.nextUrl

  const allowList = [
    "/gate",
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
  const cookie = req.cookies.get("nona_auth")?.value
  const ok = await verify(cookie, secret)

  if (ok) {
    return NextResponse.next()
  }

  const url = req.nextUrl.clone()
  url.pathname = "/gate"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
}
