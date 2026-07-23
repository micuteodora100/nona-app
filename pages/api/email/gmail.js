import { getServerSession } from "next-auth"
import { getAuthOptions } from "../auth/[...nextauth]"
import { getAccessToken } from "../../../lib/tokens"
import { google } from "googleapis"

// Decode Gmail's base64url body parts into plain text, walking nested MIME parts
function extractBody(payload) {
  if (!payload) return ""

  function decode(data) {
    if (!data) return ""
    try {
      return Buffer.from(data, "base64").toString("utf-8")
    } catch {
      return ""
    }
  }

  function stripHtml(html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  // Direct body on this part
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decode(payload.body.data)
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decode(payload.body.data))
  }

  // Walk nested parts, preferring text/plain
  if (payload.parts?.length) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain" && p.body?.data)
    if (plain) return decode(plain.body.data)

    const html = payload.parts.find((p) => p.mimeType === "text/html" && p.body?.data)
    if (html) return stripHtml(decode(html.body.data))

    // Recurse into multipart/alternative or multipart/mixed
    for (const part of payload.parts) {
      const nested = extractBody(part)
      if (nested) return nested
    }
  }

  return ""
}

// Find the first PDF attachment part in a message payload (walks nested parts)
function findPdfAttachment(payload) {
  if (!payload) return null
  if (payload.mimeType === "application/pdf" && payload.body?.attachmentId) {
    return { attachmentId: payload.body.attachmentId, filename: payload.filename || "attachment.pdf" }
  }
  if (payload.parts?.length) {
    for (const part of payload.parts) {
      const found = findPdfAttachment(part)
      if (found) return found
    }
  }
  return null
}

// Fetch a Gmail attachment and extract its text (e.g. flight/hotel e-tickets)
async function extractPdfText(gmail, messageId, attachmentId) {
  try {
    const pdfParse = (await import("pdf-parse")).default
    const att = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    })
    const buffer = Buffer.from(att.data.data, "base64")
    const parsed = await pdfParse(buffer)
    // Cap extracted text — tickets/confirmations rarely need more than this to find dates/flight numbers
    return (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 1500)
  } catch (err) {
    console.error("PDF extract failed:", err.message)
    return ""
  }
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, getAuthOptions(req))
  const googleAuth = session?.providers?.google
  if (!googleAuth) {
    return res.status(401).json({ error: "Not authenticated with Google" })
  }

  try {
    const accessToken = await getAccessToken(googleAuth.email, "google")
    if (!accessToken) {
      return res.status(401).json({ error: "Google connection expired — reconnect Gmail in Settings" })
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oauth2Client.setCredentials({ access_token: accessToken })

    const gmail = google.gmail({ version: "v1", auth: oauth2Client })

    // Fetch last 90 days of emails from inbox (read + unread)
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox newer_than:90d",
      maxResults: 100,
    })

    const messages = listRes.data.messages || []

    if (messages.length === 0) {
      return res.json({ emails: [], source: "gmail" })
    }

    // Fetch each message's full content (was: format "metadata" — 150-char snippet only)
    // IMPORTANT: never fetch all messages in one unbounded Promise.all — with up to 100
    // messages that reliably trips Gmail API rate limits and/or Vercel's serverless
    // timeout, and a single failed message used to take the whole request down with it
    // (Promise.all rejects entirely on one rejection). Batch in groups of 10, cap total
    // full-body fetches at 40 (most recent first — already sorted by Gmail), and use
    // allSettled so one bad message never blocks the rest.
    const BATCH_SIZE = 10
    const MAX_FULL_FETCH = 40
    const toFetch = messages.slice(0, MAX_FULL_FETCH)

    // Cap total PDF attachment fetches per request — extracting text from a PDF
    // (download + parse) is much slower than reading email body, so this protects
    // the 30s serverless timeout when many emails have attachments at once.
    const MAX_PDF_FETCHES = 15
    let pdfFetchCount = 0

    async function fetchOne(msg) {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      })

      const headers = detail.data.payload.headers
      const get = (name) => headers.find((h) => h.name === name)?.value || ""

      const fullBody = extractBody(detail.data.payload)
      // Cap at ~3000 chars to keep AI prompt cost/latency reasonable —
      // still ~20x more context than the old 150-char preview.
      let body = fullBody.slice(0, 3000)

      // If there's a PDF attachment (e-tickets, hotel confirmations, invoices often
      // put the real dates/details in the PDF, not the email body), extract its text
      // and append it so the AI triage/calendar prompt actually sees it.
      const pdfAttachment = findPdfAttachment(detail.data.payload)
      if (pdfAttachment && pdfFetchCount < MAX_PDF_FETCHES) {
        pdfFetchCount++
        const pdfText = await extractPdfText(gmail, msg.id, pdfAttachment.attachmentId)
        if (pdfText) {
          body += `\n\n[Attachment: ${pdfAttachment.filename}]\n${pdfText}`
        }
      }

      return {
        id: msg.id,
        from: get("From"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: detail.data.snippet || "", // short preview, still used for UI cards
        body,                                // full(er) content, used for AI triage/parsing
        hasPdf: !!pdfAttachment,
        source: "gmail",
      }
    }

    const emails = []
    const failedIds = []
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batch = toFetch.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(batch.map(fetchOne))
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          emails.push(r.value)
        } else {
          failedIds.push(batch[idx].id)
          console.error("Gmail message fetch failed:", batch[idx].id, r.reason?.message)
        }
      })
    }

    if (failedIds.length > 0) {
      console.warn(`Gmail: ${failedIds.length}/${toFetch.length} messages failed to fetch, continuing with the rest`)
    }

    res.json({ emails, source: "gmail", skipped: messages.length - toFetch.length, failed: failedIds.length })
  } catch (err) {
    console.error("Gmail error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
