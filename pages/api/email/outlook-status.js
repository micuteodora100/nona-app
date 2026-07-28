import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"

// Test Microsoft Graph connection using the stored access token
export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.json({ ok: false, error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "microsoft")
    if (!accessToken) {
      return res.json({ ok: false, error: "Microsoft connection expired — reconnect Outlook in Settings" })
    }

    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const err = await response.text()
      return res.json({ ok: false, error: `Graph API error: ${response.status}` })
    }

    const profile = await response.json()
    return res.json({ ok: true, email: profile.mail || profile.userPrincipalName })
  } catch (err) {
    return res.json({ ok: false, error: err.message })
  }
}
