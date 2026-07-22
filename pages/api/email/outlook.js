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

// Fetch PDF attachments for a message via Microsoft Graph and extract their text
// (e.g. Luxair/airline e-tickets, hotel confirmations often bury dates in the PDF, not the body)
async function extractPdfTextFromMessage(messageId, accessToken) {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) return ""
    const data = await res.json()
    const pdfAttachment = (data.value || []).find(
      (a) => a.contentType === "application/pdf" && a.contentBytes
    )
    if (!pdfAttachment) return ""

    const pdfParse = (await import("pdf-parse")).default
    const buffer = Buffer.from(pdfAttachment.contentBytes, "base64")
    const parsed = await pdfParse(buffer)
    return (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 1500)
  } catch (err) {
    console.error("Outlook PDF extract failed:", err.message)
    return ""
  }
}

// Microsoft Graph API — proper OAuth, replaces broken IMAP approach
// Reads emails from user's Outlook inbox using their access token
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions)

  const microsoftAuth = session?.providers?.microsoft
  if (!microsoftAuth) {
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
      // was: bodyPreview only (~255 chars) — now also request full "body",
      // plus hasAttachments so we know which messages are worth an extra
      // attachments lookup (most emails have none — no need to call for those)
      `&$select=id,subject,from,receivedDateTime,bodyPreview,body,isRead,hasAttachments` +
      `&$orderby=receivedDateTime desc`,
      {
        headers: {
          Authorization: `Bearer ${microsoftAuth.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!response.ok) {
      const err = await response.text()
      throw new Error(err)
    }

    const data = await response.json()
    const rawMessages = data.value || []

    // Cap total PDF attachment fetches per request — each one is an extra Graph
    // API call plus PDF parse, so this protects the 30s serverless timeout.
    const MAX_PDF_FETCHES = 15
    let pdfFetchCount = 0

    const emails = await Promise.all(
      rawMessages.map(async (msg) => {
        const raw = msg.body?.content || ""
        const plain = msg.body?.contentType === "html" ? stripHtml(raw) : raw
        let body = plain.slice(0, 3000)

        let hasPdf = false
        if (msg.hasAttachments && pdfFetchCount < MAX_PDF_FETCHES) {
          pdfFetchCount++
          const pdfText = await extractPdfTextFromMessage(msg.id, microsoftAuth.accessToken)
          if (pdfText) {
            hasPdf = true
            body += `\n\n[Attachment]\n${pdfText}`
          }
        }

        return {
          id: msg.id,
          from: `${msg.from?.emailAddress?.name || ""} <${msg.from?.emailAddress?.address || ""}>`,
          subject: msg.subject || "(no subject)",
          date: msg.receivedDateTime,
          snippet: msg.bodyPreview || "", // short preview, still used for UI cards
          body,                            // full(er) content, used for AI triage/parsing
          isRead: msg.isRead,
          hasPdf,
          source: "outlook",
        }
      })
    )

    res.json({ emails, source: "outlook" })
  } catch (err) {
    console.error("Outlook Graph error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
