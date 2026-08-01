import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"
import { fetchOutlookEmails } from "../../../lib/email-fetch"

// Microsoft Graph API — proper OAuth, replaces broken IMAP approach
// Reads emails from user's Outlook inbox using their access token
export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "microsoft")
    if (!accessToken) {
      return res.status(401).json({ error: "Outlook connection expired — reconnect Outlook in Settings", reconnectRequired: true })
    }

    const result = await fetchOutlookEmails(accessToken)
    res.json({ ...result, source: "outlook" })
  } catch (err) {
    // See the matching comment in pages/api/email/gmail.js — a withdrawn
    // consent is a reconnect prompt, not a 500 with raw Graph output.
    if (err.reconnectRequired) {
      console.error("Outlook needs reconnect:", err.message)
      return res.status(401).json({ error: "Outlook access was revoked or expired — reconnect Outlook in Settings", reconnectRequired: true })
    }
    console.error("Outlook Graph error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
