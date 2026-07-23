import { getServerSession } from "next-auth"
import { getAuthOptions } from "../auth/[...nextauth]"
import { getAccessToken } from "../../../lib/tokens"

// Test Microsoft Graph connection using the stored access token
export default async function handler(req, res) {
  const session = await getServerSession(req, res, getAuthOptions(req))
  const microsoftAuth = session?.providers?.microsoft

  if (!microsoftAuth) {
    return res.json({ ok: false, error: "Not connected with Microsoft account" })
  }

  try {
    const accessToken = await getAccessToken(microsoftAuth.email, "microsoft")
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
