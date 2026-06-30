// Simple password gate API — checks password, sets a signed cookie
import crypto from "crypto"

function sign(value) {
  const hmac = crypto.createHmac("sha256", process.env.NEXTAUTH_SECRET || "fallback-secret")
  hmac.update(value)
  return value + "." + hmac.digest("hex")
}

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()
  const { password } = req.body

  if (password === process.env.APP_PASSWORD) {
    const token = sign("authenticated")
    res.setHeader(
      "Set-Cookie",
      `nona_auth=${token}; Path=/; HttpOnly; Max-Age=${60 * 60 * 24 * 90}; SameSite=Lax; Secure`
    )
    return res.json({ ok: true })
  }

  res.status(401).json({ ok: false, error: "Wrong password" })
}
