import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"
import { fetchGmailEmails } from "../../../lib/email-fetch"

export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "google")
    if (!accessToken) {
      return res.status(401).json({ error: "Google connection expired — reconnect Gmail in Settings" })
    }

    const result = await fetchGmailEmails(accessToken)
    res.json({ ...result, source: "gmail" })
  } catch (err) {
    console.error("Gmail error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
