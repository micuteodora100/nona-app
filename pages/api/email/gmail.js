import { getServerSession } from "next-auth"
import { authOptions } from "../auth/[...nextauth]"
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

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions)
  if (!session || session.provider !== "google") {
    return res.status(401).json({ error: "Not authenticated with Google" })
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oauth2Client.setCredentials({ access_token: session.accessToken })

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
      const body = fullBody.slice(0, 3000)

      return {
        id: msg.id,
        from: get("From"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: detail.data.snippet || "", // short preview, still used for UI cards
        body,                                // full(er) content, used for AI triage/parsing
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
