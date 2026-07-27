import { getSupabaseServer } from "../../../lib/supabase-server"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  // Honeypot: real users never fill this hidden field, bots do.
  if (req.body?.company) return res.json({ ok: true })

  const email = String(req.body?.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: "Not configured" })

  const { error } = await supabase
    .from("mailing_list_subscribers")
    .upsert({ email, subscribed: true, unsubscribed_at: null }, { onConflict: "email" })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
}
