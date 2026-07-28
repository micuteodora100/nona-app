import { getSupabaseServer } from "../../lib/supabase-server"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_MESSAGE_LENGTH = 5000

// Best-effort notification so the founder sees new messages without checking
// Supabase manually. reply_to is the visitor's address, not ours — replying
// in the inbox goes straight to them without our address ever being shown.
async function notifyByEmail(email, message) {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.CONTACT_NOTIFY_EMAIL
  if (!apiKey || !to) return

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Nona <onboarding@resend.dev>",
      to,
      reply_to: email,
      subject: "New message via usenona.com",
      text: `From: ${email}\n\n${message}`,
    }),
  })
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  // Honeypot: real users never fill this hidden field, bots do.
  if (req.body?.company) return res.json({ ok: true })

  const email = String(req.body?.email || "").trim().toLowerCase()
  const message = String(req.body?.message || "").trim()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" })
  if (!message) return res.status(400).json({ error: "Enter a message" })
  if (message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: "Message is too long" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: "Not configured" })

  const { error } = await supabase.from("contact_messages").insert({ email, message })
  if (error) return res.status(500).json({ error: error.message })

  notifyByEmail(email, message).catch(err => console.error("Contact notification email failed:", err))

  res.json({ ok: true })
}
