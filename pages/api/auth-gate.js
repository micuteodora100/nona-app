import crypto from "crypto"

// In-memory rate limiter — resets on server restart, good enough for personal use
const attempts = {}
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes

function sign(value) {
  const hmac = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET || "fallback-secret")
  hmac.update(value)
  return value + "." + hmac.digest("hex")
}

function getIP(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "unknown"
}

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const ip = getIP(req)
  const now = Date.now()
  const record = attempts[ip] || { count: 0, lockedUntil: 0 }

  // Check if locked out
  if (record.lockedUntil > now) {
    const minutesLeft = Math.ceil((record.lockedUntil - now) / 60000)
    return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${minutesLeft} minute${minutesLeft > 1 ? "s" : ""}.` })
  }

  const { password } = req.body

  if (password === process.env.APP_PASSWORD) {
    // Success — clear attempts, set 24h session cookie
    delete attempts[ip]
    const token = sign("authenticated")
    res.setHeader(
      "Set-Cookie",
      `nona_auth=${token}; Path=/; HttpOnly; Max-Age=${60 * 60 * 24}; SameSite=Lax; Secure`
    )
    return res.json({ ok: true })
  }

  // Wrong password — increment attempt counter
  record.count += 1
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS
    record.count = 0
  }
  attempts[ip] = record

  const remaining = MAX_ATTEMPTS - record.count
  return res.status(401).json({
    ok: false,
    error: remaining > 0
      ? `Wrong password. ${remaining} attempt${remaining > 1 ? "s" : ""} remaining.`
      : "Too many attempts. Try again in 15 minutes."
  })
}
