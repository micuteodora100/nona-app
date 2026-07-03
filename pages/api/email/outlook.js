import { getServerSession } from "next-auth"
import { authOptions } from "../auth/[...nextauth]"

function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

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
      // was: bodyPreview only (~255 chars) — now also request full "body"
      `&$select=id,subject,from,receivedDateTime,bodyPreview,body,isRead` +
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
    const emails = (data.value || []).map(msg => {
      const raw = msg.body?.content || ""
      const plain = msg.body?.contentType === "html" ? stripHtml(raw) : raw
      // Cap at ~3000 chars to keep AI prompt cost/latency reasonable
      const body = plain.slice(0, 3000)

      return {
        id: msg.id,
        from: `${msg.from?.emailAddress?.name || ""} <${msg.from?.emailAddress?.address || ""}>`,
        subject: msg.subject || "(no subject)",
        date: msg.receivedDateTime,
        snippet: msg.bodyPreview || "", // short preview, still used for UI cards
        body,                            // full(er) content, used for AI triage/parsing
        isRead: msg.isRead,
        source: "outlook",
      }
    })

    res.json({ emails, source: "outlook" })
  } catch (err) {
    console.error("Outlook Graph error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
