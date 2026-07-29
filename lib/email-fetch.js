import { cleanPdfText } from "./pdf-text"
import { google } from "googleapis"

// Core Gmail/Outlook fetch logic, factored out of pages/api/email/gmail.js and
// pages/api/email/outlook.js so the morning-brief cron (pages/api/cron/morning-brief.js)
// can reuse the exact same fetch behavior server-to-server, given an already-resolved
// access token, instead of re-implementing it. The two API routes now just resolve the
// caller's identity/token and delegate here; behavior is unchanged from before this split.

function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ── Gmail ────────────────────────────────────────────────────────────────

// Decode Gmail's base64url body parts into plain text, walking nested MIME parts
function extractGmailBody(payload) {
  if (!payload) return ""

  function decode(data) {
    if (!data) return ""
    try {
      return Buffer.from(data, "base64").toString("utf-8")
    } catch {
      return ""
    }
  }

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decode(payload.body.data)
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decode(payload.body.data))
  }

  if (payload.parts?.length) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain" && p.body?.data)
    if (plain) return decode(plain.body.data)

    const html = payload.parts.find((p) => p.mimeType === "text/html" && p.body?.data)
    if (html) return stripHtml(decode(html.body.data))

    for (const part of payload.parts) {
      const nested = extractGmailBody(part)
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
async function extractGmailPdfText(gmail, messageId, attachmentId) {
  try {
    const pdfParse = (await import("pdf-parse")).default
    const att = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    })
    const buffer = Buffer.from(att.data.data, "base64")
    const parsed = await pdfParse(buffer)
    return cleanPdfText(parsed.text).slice(0, 1500)
  } catch (err) {
    console.error("PDF extract failed:", err.message)
    return ""
  }
}

// Fetches recent Gmail inbox messages for an already-authorized access token.
// Options let callers with tighter time/cost budgets (the cron) request a
// smaller window than the interactive Mail tab's defaults.
export async function fetchGmailEmails(accessToken, opts = {}) {
  const {
    newerThanDays = 90,
    maxResults = 100,
    maxFullFetch = 40,
    maxTravelTopup = 10,
    maxPdfFetches = 15,
  } = opts

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2Client.setCredentials({ access_token: accessToken })

  const gmail = google.gmail({ version: "v1", auth: oauth2Client })

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: `in:inbox newer_than:${newerThanDays}d`,
    maxResults,
  })

  const messages = listRes.data.messages || []
  if (messages.length === 0) {
    return { emails: [], skipped: 0, travelTopup: 0, failed: 0 }
  }

  // IMPORTANT: never fetch all messages in one unbounded Promise.all — with up to 100
  // messages that reliably trips Gmail API rate limits and/or Vercel's serverless
  // timeout, and a single failed message used to take the whole request down with it
  // (Promise.all rejects entirely on one rejection). Batch in groups of 10, cap total
  // full-body fetches, and use allSettled so one bad message never blocks the rest.
  const BATCH_SIZE = 10
  const toFetch = messages.slice(0, maxFullFetch)

  // The full-fetch cap above means an older travel confirmation (flight,
  // e-ticket, hotel) can silently never reach the AI once enough newer mail has
  // arrived since — bad specifically for calendar events, which often come from
  // an email sent well before the trip. Top up with a small, separately-queried
  // batch of older booking-looking emails (by subject) so they aren't dropped
  // just for being old.
  let travelTopup = []
  if (messages.length > maxFullFetch) {
    try {
      const alreadyFetched = new Set(toFetch.map((m) => m.id))
      const travelRes = await gmail.users.messages.list({
        userId: "me",
        q: `in:inbox newer_than:${newerThanDays}d subject:(flight OR e-ticket OR eticket OR boarding OR itinerary OR booking OR reservation OR confirmation)`,
        maxResults: maxFullFetch + maxTravelTopup,
      })
      travelTopup = (travelRes.data.messages || [])
        .filter((m) => !alreadyFetched.has(m.id))
        .slice(0, maxTravelTopup)
    } catch (err) {
      console.error("Gmail travel top-up search failed:", err.message)
    }
  }
  const toFetchAll = [...toFetch, ...travelTopup]

  let pdfFetchCount = 0

  async function fetchOne(msg) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    })

    const headers = detail.data.payload.headers
    const get = (name) => headers.find((h) => h.name === name)?.value || ""

    const fullBody = extractGmailBody(detail.data.payload)
    let body = fullBody.slice(0, 3000)

    const pdfAttachment = findPdfAttachment(detail.data.payload)
    if (pdfAttachment && pdfFetchCount < maxPdfFetches) {
      pdfFetchCount++
      const pdfText = await extractGmailPdfText(gmail, msg.id, pdfAttachment.attachmentId)
      if (pdfText) {
        body += `\n\n[Attachment: ${pdfAttachment.filename}]\n${pdfText}`
      }
    }

    return {
      id: msg.id,
      from: get("From"),
      subject: get("Subject"),
      date: get("Date"),
      snippet: detail.data.snippet || "",
      body,
      hasPdf: !!pdfAttachment,
      source: "gmail",
    }
  }

  const emails = []
  const failedIds = []
  for (let i = 0; i < toFetchAll.length; i += BATCH_SIZE) {
    const batch = toFetchAll.slice(i, i + BATCH_SIZE)
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
    console.warn(`Gmail: ${failedIds.length}/${toFetchAll.length} messages failed to fetch, continuing with the rest`)
  }

  return { emails, skipped: messages.length - toFetch.length, travelTopup: travelTopup.length, failed: failedIds.length }
}

// ── Outlook ──────────────────────────────────────────────────────────────

// Fetch PDF attachments for a message via Microsoft Graph and extract their text
async function extractOutlookPdfText(messageId, accessToken) {
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
    return cleanPdfText(parsed.text).slice(0, 1500)
  } catch (err) {
    console.error("Outlook PDF extract failed:", err.message)
    return ""
  }
}

// Fetches recent Outlook inbox messages via Microsoft Graph for an
// already-authorized access token.
export async function fetchOutlookEmails(accessToken, opts = {}) {
  const { sinceDays = 90, maxResults = 100, maxPdfFetches = 15, maxTravelTopup = 10 } = opts

  const since = new Date()
  since.setDate(since.getDate() - sinceDays)
  const sinceISO = since.toISOString()

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
    `?$filter=receivedDateTime ge ${sinceISO}` +
    `&$top=${maxResults}` +
    `&$select=id,subject,from,receivedDateTime,bodyPreview,body,isRead,hasAttachments` +
    `&$orderby=receivedDateTime desc`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
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

  // Same rescue Gmail already has (see fetchGmailEmails' travelTopup): the
  // most-recent-N fetch above silently drops anything older once the inbox
  // has more than `maxResults` messages in the window — found 29 Jul 2026 on
  // a real account with 1776 inbox messages in 90 days, where the top-100 cut
  // off after only ~5 days and completely excluded a real flight e-ticket
  // from less than 2 weeks earlier. $filter doesn't support "contains" on
  // subject in Graph, so this uses $search (scoped to subject) instead, which
  // finds travel-looking mail by keyword regardless of how far back it sits.
  let travelTopup = []
  if (rawMessages.length >= maxResults) {
    try {
      const keywords = ["flight", "e-ticket", "eticket", "boarding", "itinerary", "booking", "reservation", "confirmation"]
      const searchExpr = keywords.map((k) => `subject:${k}`).join(" OR ")
      const alreadyFetched = new Set(rawMessages.map((m) => m.id))
      const searchRes = await fetch(
        `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
        `?$search=${encodeURIComponent(`"${searchExpr}"`)}` +
        `&$select=id,subject,from,receivedDateTime,bodyPreview,body,isRead,hasAttachments` +
        `&$top=${maxTravelTopup + 15}`,
        { headers: { Authorization: `Bearer ${accessToken}`, ConsistencyLevel: "eventual" } }
      )
      if (searchRes.ok) {
        const searchData = await searchRes.json()
        travelTopup = (searchData.value || [])
          .filter((m) => !alreadyFetched.has(m.id) && new Date(m.receivedDateTime) >= since)
          .slice(0, maxTravelTopup)
      } else {
        console.error("Outlook travel top-up search failed:", searchRes.status, await searchRes.text())
      }
    } catch (err) {
      console.error("Outlook travel top-up search failed:", err.message)
    }
  }
  const allRawMessages = [...rawMessages, ...travelTopup]

  let pdfFetchCount = 0

  async function fetchOne(msg) {
    const raw = msg.body?.content || ""
    const plain = msg.body?.contentType === "html" ? stripHtml(raw) : raw
    let body = plain.slice(0, 3000)

    let hasPdf = false
    if (msg.hasAttachments && pdfFetchCount < maxPdfFetches) {
      pdfFetchCount++
      const pdfText = await extractOutlookPdfText(msg.id, accessToken)
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
      snippet: msg.bodyPreview || "",
      body,
      isRead: msg.isRead,
      hasPdf,
      source: "outlook",
    }
  }

  const BATCH_SIZE = 10
  const emails = []
  const failedIds = []
  for (let i = 0; i < allRawMessages.length; i += BATCH_SIZE) {
    const batch = allRawMessages.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(fetchOne))
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        emails.push(r.value)
      } else {
        failedIds.push(batch[idx].id)
        console.error("Outlook message fetch failed:", batch[idx].id, r.reason?.message)
      }
    })
  }

  if (failedIds.length > 0) {
    console.warn(`Outlook: ${failedIds.length}/${allRawMessages.length} messages failed to fetch, continuing with the rest`)
  }

  return { emails, travelTopup: travelTopup.length, failed: failedIds.length }
}
