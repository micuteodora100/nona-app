import { getSupabaseServer } from "../../../lib/supabase-server"
import { verifyTurnstile } from "../../../lib/turnstile"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const captcha = await verifyTurnstile(req.body?.captchaToken, req)
  if (!captcha.ok) return res.status(400).json({ error: captcha.error })

  const email = String(req.body?.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: "Not configured" })

  const { error } = await supabase
    .from("mailing_list_subscribers")
    .update({ subscribed: false, unsubscribed_at: new Date().toISOString() })
    .eq("email", email)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
}
