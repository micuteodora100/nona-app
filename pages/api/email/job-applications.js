import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"
import { fetchJobApplicationGmailEmails, fetchJobApplicationOutlookEmails } from "../../../lib/email-fetch"
import { runJobApplicationClassifyPrompt } from "../../../lib/job-application-extract"
import { getAnthropicClient } from "../../../lib/ai-brief"

// Pending job application tracker — scans the inbox for emails matching a
// job-application keyword search, classifies each via AI for genuine
// relevance (lib/job-application-extract.js), groups by company, and flags
// any company whose most recent application-related email is still just the
// "applied" stage (no interview invite, rejection or offer since) once
// PENDING_THRESHOLD_DAYS have passed. Read-only, reuses the gmail.readonly /
// Mail.Read scopes already granted — no new OAuth consent needed.
const LOOKBACK_DAYS = 60
const PENDING_THRESHOLD_DAYS = 10

const client = getAnthropicClient()

function daysSince(timestampMs) {
  return Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24))
}

export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const candidateEmails = []
  const errors = []

  try {
    const googleToken = await getAccessToken(user.id, "google")
    if (googleToken) {
      try {
        const { emails } = await fetchJobApplicationGmailEmails(googleToken, { newerThanDays: LOOKBACK_DAYS })
        candidateEmails.push(...emails)
      } catch (err) {
        console.error("Gmail job-application fetch error:", err.message)
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
        const { emails } = await fetchJobApplicationOutlookEmails(msToken, { sinceDays: LOOKBACK_DAYS })
        candidateEmails.push(...emails)
      } catch (err) {
        console.error("Outlook job-application fetch error:", err.message)
        errors.push(`Outlook: ${err.message}`)
      }
    }
  } catch (err) {
    console.error("Microsoft token error:", err.message)
  }

  if (candidateEmails.length === 0) {
    return res.json({ pending: [], errors })
  }

  let classified = []
  try {
    classified = await runJobApplicationClassifyPrompt(client, candidateEmails)
  } catch (err) {
    console.error("Job application classify error:", err.message)
    return res.json({ pending: [], errors: [...errors, err.message] })
  }

  const emailById = new Map(candidateEmails.map((e) => [e.id, e]))

  // One company can produce several matching emails (applied, then invited,
  // then rejected) — only the most recent one per company determines
  // whether it's still pending, same idea as "last message in the thread" in
  // the waiting-for-replies tracker.
  const byCompany = new Map()
  for (const c of classified) {
    if (!c.is_job_application_related || !c.company?.trim()) continue
    const email = emailById.get(c.email_id)
    if (!email) continue
    const date = new Date(email.date).getTime()
    if (!Number.isFinite(date)) continue

    const key = c.company.trim().toLowerCase()
    const existing = byCompany.get(key)
    if (!existing || date > existing.date) {
      byCompany.set(key, { company: c.company.trim(), role: c.role || "", status: c.status, date, subject: email.subject })
    }
  }

  const pending = [...byCompany.values()]
    .filter((entry) => entry.status === "applied" && daysSince(entry.date) >= PENDING_THRESHOLD_DAYS)
    .map((entry) => ({
      company: entry.company,
      role: entry.role,
      subject: entry.subject,
      days: daysSince(entry.date),
      appliedDate: new Date(entry.date).toISOString().slice(0, 10),
    }))
    .sort((a, b) => b.days - a.days)

  res.json({ pending, errors })
}
