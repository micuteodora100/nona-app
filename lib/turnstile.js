const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// Supabase verifies Turnstile itself for auth endpoints (Authentication →
// Attack Protection), but our own API routes — contact, mailing list — have to
// do it here, or the widget is decoration a bot can simply skip by POSTing the
// endpoint directly.
export function turnstileConfigured() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"]
  if (!fwd) return undefined
  return String(fwd).split(",")[0].trim() || undefined
}

// Returns { ok: true } when the token is valid, or when Turnstile isn't
// configured at all (so the forms keep working before the keys are set).
export async function verifyTurnstile(token, req) {
  if (!turnstileConfigured()) return { ok: true }
  if (!token) return { ok: false, error: "Please complete the verification check" }

  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY,
    response: token,
  })
  const ip = clientIp(req)
  if (ip) body.set("remoteip", ip)

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body })
    const data = await res.json()
    if (data.success) return { ok: true }
    console.warn("Turnstile rejected a submission:", data["error-codes"])
    return { ok: false, error: "Verification failed — please try again" }
  } catch (err) {
    // Fails closed. A Cloudflare outage blocking the contact form for a while
    // is recoverable; a verification step that waves everything through the
    // moment it errors is not a verification step. Both forms still have their
    // honeypot as a second layer.
    console.error("Turnstile verification request failed:", err)
    return { ok: false, error: "Verification is unavailable right now — please try again shortly" }
  }
}
