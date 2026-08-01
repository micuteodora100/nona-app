import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"
import { fetchGmailEmails } from "../../../lib/email-fetch"

export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "google")
    if (!accessToken) {
      return res.status(401).json({ error: "Gmail connection expired — reconnect Gmail in Settings", reconnectRequired: true })
    }

    const result = await fetchGmailEmails(accessToken)
    res.json({ ...result, source: "gmail" })
  } catch (err) {
    // A revoked or expired Google grant used to surface here as a 500
    // carrying the raw upstream text ("Google token refresh failed: 400"),
    // with no hint that reconnecting is what fixes it. Same shape the
    // calendar route already returns — see pages/api/calendar/google.js.
    if (err.reconnectRequired) {
      console.error("Gmail needs reconnect:", err.message)
      return res.status(401).json({ error: "Gmail access was revoked or expired — reconnect Gmail in Settings", reconnectRequired: true })
    }
    console.error("Gmail error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
