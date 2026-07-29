import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"
import { google } from "googleapis"

// "Waiting for replies" tracker — scans the user's SENT mail from the last
// DAYS_LOOKBACK days and flags threads/conversations whose most recent
// message is still the user's own (i.e. nobody has replied) once
// WAIT_THRESHOLD_DAYS have passed. Read-only, reuses the gmail.readonly /
// Mail.Read scopes already granted for the existing inbox fetch — no new
// OAuth consent needed.
//
// WAIT_THRESHOLD_DAYS=5 and DAYS_LOOKBACK=14 are the most conservative
// reversible defaults (matches the ROADMAP.md spec of "5+ days"); both are
// easy config knobs to expose later if the owner wants them adjustable.
const DAYS_LOOKBACK = 14
const WAIT_THRESHOLD_DAYS = 5

// Same caution as gmail.js/outlook.js: an unbounded scan of sent mail plus
// one extra API call per thread/conversation to check for replies is exactly
// the shape of request that trips Vercel's serverless timeout and provider
// rate limits. Cap how many sent messages we list, and separately cap how
// many distinct threads we open (the expensive part) — a handful of sent
// messages commonly share the same thread (follow-ups), so this is usually
// well under MAX_SENT_FETCH anyway.
const MAX_SENT_FETCH = 40
const MAX_THREADS_CHECK = 25
const BATCH_SIZE = 10

function daysSince(timestampMs) {
  return Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24))
}

async function checkGmail(accessToken) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  oauth2Client.setCredentials({ access_token: accessToken })
  const gmail = google.gmail({ version: "v1", auth: oauth2Client })

  const profile = await gmail.users.getProfile({ userId: "me" })
  const myEmail = (profile.data.emailAddress || "").toLowerCase()

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: `in:sent newer_than:${DAYS_LOOKBACK}d`,
    maxResults: MAX_SENT_FETCH,
  })
  const sent = listRes.data.messages || []
  if (sent.length === 0) return []

  // Multiple sent messages can belong to the same thread (follow-ups) — only
  // need to check each thread once.
  const threadIds = [...new Set(sent.map((m) => m.threadId))].slice(0, MAX_THREADS_CHECK)

  const waiting = []
  for (let i = 0; i < threadIds.length; i += BATCH_SIZE) {
    const batch = threadIds.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((id) =>
        gmail.users.threads.get({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject"],
        })
      )
    )
    results.forEach((r) => {
      if (r.status !== "fulfilled") {
        console.error("Gmail thread fetch failed:", r.reason?.message)
        return
      }
      const messages = (r.value.data.messages || [])
        .slice()
        .sort((a, b) => Number(a.internalDate) - Number(b.internalDate))
      if (messages.length === 0) return

      const last = messages[messages.length - 1]
      const headers = last.payload?.headers || []
      const get = (name) => headers.find((h) => h.name === name)?.value || ""
      const fromLast = get("From").toLowerCase()
      if (!fromLast.includes(myEmail)) return // last message in the thread is from someone else — they replied

      const days = daysSince(Number(last.internalDate))
      if (days < WAIT_THRESHOLD_DAYS) return

      waiting.push({
        source: "gmail",
        subject: get("Subject") || "(no subject)",
        to: get("To") || "",
        days,
        threadId: r.value.data.id,
      })
    })
  }
  return waiting
}

async function checkOutlook(accessToken) {
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!meRes.ok) throw new Error(await meRes.text())
  const me = await meRes.json()
  const myEmail = (me.mail || me.userPrincipalName || "").toLowerCase()

  const since = new Date()
  since.setDate(since.getDate() - DAYS_LOOKBACK)
  const sinceISO = since.toISOString()

  const sentRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages` +
    `?$filter=sentDateTime ge ${sinceISO}` +
    `&$top=${MAX_SENT_FETCH}` +
    `&$select=id,subject,toRecipients,sentDateTime,conversationId` +
    `&$orderby=sentDateTime desc`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!sentRes.ok) throw new Error(await sentRes.text())
  const sentData = await sentRes.json()
  const sentMessages = sentData.value || []
  if (sentMessages.length === 0) return []

  // Same dedup-by-thread idea as Gmail, keyed on conversationId.
  const seen = new Set()
  const conversations = []
  for (const m of sentMessages) {
    if (m.conversationId && !seen.has(m.conversationId)) {
      seen.add(m.conversationId)
      conversations.push(m)
      if (conversations.length >= MAX_THREADS_CHECK) break
    }
  }

  const waiting = []
  for (let i = 0; i < conversations.length; i += BATCH_SIZE) {
    const batch = conversations.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((m) =>
        fetch(
          `https://graph.microsoft.com/v1.0/me/messages` +
          `?$filter=conversationId eq '${m.conversationId}'` +
          `&$select=id,from,sentDateTime,receivedDateTime` +
          `&$top=10`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ).then((r) => {
          if (!r.ok) throw new Error(`Graph ${r.status}`)
          return r.json()
        })
      )
    )
    results.forEach((r, idx) => {
      if (r.status !== "fulfilled") {
        console.error("Outlook conversation fetch failed:", r.reason?.message)
        return
      }
      const msgs = (r.value.value || [])
        .slice()
        .sort((a, b) => new Date(a.sentDateTime || a.receivedDateTime) - new Date(b.sentDateTime || b.receivedDateTime))
      if (msgs.length === 0) return

      const last = msgs[msgs.length - 1]
      const fromLast = (last.from?.emailAddress?.address || "").toLowerCase()
      if (fromLast !== myEmail) return // last message in the conversation is from someone else — they replied

      const lastDate = new Date(last.sentDateTime || last.receivedDateTime).getTime()
      const days = daysSince(lastDate)
      if (days < WAIT_THRESHOLD_DAYS) return

      const origin = batch[idx]
      waiting.push({
        source: "outlook",
        subject: origin.subject || "(no subject)",
        to: (origin.toRecipients || []).map((rec) => rec.emailAddress?.address).filter(Boolean).join(", "),
        days,
        threadId: origin.conversationId,
      })
    })
  }
  return waiting
}

export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const waiting = []
  const errors = []

  try {
    const googleToken = await getAccessToken(user.id, "google")
    if (googleToken) {
      try {
        waiting.push(...(await checkGmail(googleToken)))
      } catch (err) {
        console.error("Gmail waiting-for-replies error:", err.message)
        errors.push(`Gmail: ${err.message}`)
      }
    }
  } catch (err) {
    console.error("Gmail token error:", err.message)
  }

  try {
    const msToken = await getAccessToken(user.id, "microsoft")
    if (msToken) {
      try {
        waiting.push(...(await checkOutlook(msToken)))
      } catch (err) {
        console.error("Outlook waiting-for-replies error:", err.message)
        errors.push(`Outlook: ${err.message}`)
      }
    }
  } catch (err) {
    console.error("Microsoft token error:", err.message)
  }

  waiting.sort((a, b) => b.days - a.days)

  res.json({ waiting, errors })
}
