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
      return res.status(401).json({ error: "Microsoft connection expired — reconnect Outlook in Settings" })
    }

    const result = await fetchOutlookEmails(accessToken)
    res.json({ ...result, source: "outlook" })
  } catch (err) {
    console.error("Outlook Graph error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
