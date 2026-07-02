import { getServerSession } from "next-auth"
import { authOptions } from "../auth/[...nextauth]"

// Microsoft Graph API — proper OAuth, replaces broken IMAP approach
// Reads emails from user's Outlook inbox using their access token
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions)

  if (!session || session.provider !== "microsoft") {
    return res.status(401).json({ error: "Not authenticated with Microsoft" })
  }

  try {
    // Fetch unread emails from last 90 days using Microsoft Graph
    const since = new Date()
    since.setDate(since.getDate() - 90)
    const sinceISO = since.toISOString()

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
      `?$filter=receivedDateTime ge ${sinceISO}` +
      `&$top=100` +
      `&$select=id,subject,from,receivedDateTime,bodyPreview,isRead` +
      `&$orderby=receivedDateTime desc`,
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!response.ok) {
      const err = await response.text()
      throw new Error(err)
    }

    const data = await response.json()
    const emails = (data.value || []).map(msg => ({
      id: msg.id,
      from: `${msg.from?.emailAddress?.name || ""} <${msg.from?.emailAddress?.address || ""}>`,
      subject: msg.subject || "(no subject)",
      date: msg.receivedDateTime,
      snippet: msg.bodyPreview || "",
      isRead: msg.isRead,
      source: "outlook",
    }))

    res.json({ emails, source: "outlook" })
  } catch (err) {
    console.error("Outlook Graph error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
