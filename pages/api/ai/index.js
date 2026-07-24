import Anthropic from "@anthropic-ai/sdk"
import { getServerSession } from "next-auth"
import { getAuthOptions } from "../auth/[...nextauth]"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function parseAIJson(text) {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error("Could not extract JSON")
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const session = await getServerSession(req, res, getAuthOptions(req))
  if (!session) return res.status(401).json({ error: "Not authenticated" })

  const { type, emails, tasks, context } = req.body

  try {
    let prompt = ""

    if (type === "triage") {
      // was: 1200 chars/email — with up to 100 emails, that made the triage
      // prompt large enough to push the whole request past Vercel's
      // serverless timeout, which is what caused "Failed to fetch." 400
      // chars still gives far more context than the original 150-char
      // snippet while keeping the whole call fast enough to finish in time.
      const emailList = emails
        .map((e, i) => {
          const full = e.body || e.snippet || ""
          // PDF attachments (e-tickets, hotel confirmations) get appended after the
          // raw body as "[Attachment...]". A flat slice(0, 2200) let a long marketing/
          // legal preamble in the body crowd out the attachment text entirely — which
          // is where the actual flight number/date usually lives — so a flight ticket
          // could reach the AI with its real details already cut off. Reserve room for
          // the attachment explicitly instead of slicing the concatenated string blind.
          let content
          const attIdx = e.hasPdf ? full.indexOf("[Attachment") : -1
          if (attIdx !== -1) {
            content = full.slice(0, attIdx).slice(0, 600) + full.slice(attIdx).slice(0, 1800)
          } else {
            content = full.slice(0, e.hasPdf ? 2200 : 1000)
          }
          return `[${i + 1}] From: ${e.from}\nSubject: ${e.subject}\nContent: ${content}`
        })
        .join("\n\n")

      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      prompt = `You are Nona, a personal AI for ${context.name}, a working parent in Luxembourg (ex-Amazon senior manager, job searching for VP roles, building a startup called Nona, child named ${context.child}).

Today's actual date is ${todayStr}. Use this as ground truth for any date reasoning.

Here are her recent emails from the last 90 days (most recent first):

${emailList}

Your job is to find emails that genuinely need ${context.name}'s attention — not to summarize the whole inbox, and not to hide things out of excessive caution.

ALWAYS flag these types, with very few exceptions:
- Security alerts: password changes, security codes, login verifications, account access notices — these matter even if automated, because they could indicate her account was accessed
- Anything from a real named person (not a company/team name) — replies, questions, requests
- Anything mentioning money: invoices, payments, bills, refunds, subscriptions changing price
- Anything with a deadline, date, or appointment
- Job-search related: recruiter messages, application updates, interview requests
- Anything requiring a decision, reply, signature, or confirmation
- Account/service notices that imply something changed or needs verification (password reset, suspicious activity, 2FA codes)

ONLY ignore: pure marketing/promotional content, newsletters with no personal relevance, "you might like" recommendation emails, and automated receipts that need zero action (e.g. "your order shipped" with no problem).

When genuinely unsure, include it as "action" rather than omit it. Do not under-flag. With a typical 90-day inbox of 50-100 emails, it would be unusual for ZERO to need attention — if your urgent+action lists are empty, double-check you haven't been too conservative.

Return ONLY valid JSON, no markdown, no explanation:
{
  "urgent": [{"index": 1, "reason": "one short line — what and why"}],
  "action": [{"index": 2, "reason": "one short line — what action, by when if known"}],
  "tasks": ["concrete task extracted from an email, phrased as something to do"],
  "calendar_events": [{"text": "short event title", "date": "2026-07-03", "source_index": 1}],
  "summary": "One line: how many emails actually need attention, or 'Nothing urgent' if genuinely true."
}

Also extract calendar_events: any email that mentions a specific date + event (booking confirmation, meeting, flight, lunch, appointment, delivery) should produce a calendar event with a short title and the resolved date. Use today's date to resolve relative dates ("tomorrow", "next Tuesday"). Only extract events with a clear specific date — not vague timeframes.

Flight bookings and e-tickets need special care: create a SEPARATE calendar event for EACH leg of the trip — one for the outbound departure date, and another for the return departure date if it's a round trip (a booking confirmation email often covers both in one email, and both must be extracted, not just the first). Use the actual flight departure date, never the date the email was sent or booked. Title each one with the route and, if visible, the flight number, e.g. "✈ LGW→LIS FR1234"; fall back to "✈ Flight to [destination]" if the flight number isn't in the text.

For the tasks array: for EVERY email in urgent or action, extract at least one concrete task phrased as something to do. E.g. "Reply to Maria about contract renewal", "Pay invoice from BGL", "Confirm dentist appointment for 8 Jul". Do not leave tasks empty if there are action items.

Do not include an "fyi" bucket — if it's not worth action, don't surface it at all. Keep urgent and action arrays short — only real items, never pad them.`
    }

    if (type === "email_to_task") {
      const email = req.body.email || {}
      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      // was: email.snippet only (150 chars) — now uses full body when available
      const content = (email.body || email.snippet || "").slice(0, 1200)

      prompt = `Today's actual date is ${todayStr}.

Turn this email into ONE clear, actionable task for the recipient.

From: ${email.from}
Subject: ${email.subject}
Content: ${content}

Rules:
- "text": a short, specific task title (under 10 words if possible) describing what the recipient needs to DO — not a summary. E.g. "Reply to Maria about contract" not "Email from Maria about contract."
- "description": one short sentence (under 20 words) giving context — what the email is actually about, so the task makes sense without reopening the email.
- "date": if the email mentions any date, deadline, or appointment (even relative like "by Friday" or "next week"), resolve it to an actual date using today as reference. If genuinely no date is mentioned, use null.
- "tag": guess "family", "work", "health", "errands", or null if unclear.

Return ONLY valid JSON, no markdown:
{"text": "short task title", "description": "one short sentence of context", "date": "2026-07-12" or null, "tag": "work"}`
    }

    if (type === "parse_tasks") {
      const rawText = req.body.text || ""
      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      prompt = `Today's actual date is ${todayStr}.

Parse the following free text into distinct, separate tasks. The person may write multiple tasks run together, with or without explicit dates. Split them correctly even if punctuation is messy or dates are embedded mid-sentence.

Text: "${rawText}"

For each task:
- Extract a clean, short task description (remove date phrases from the text itself, keep it actionable)
- If a date is mentioned (even relative like "Thursday", "next week", "the 8th"), resolve it to an actual date using today's date as reference, and include it
- If no date is mentioned, leave date as null
- Guess a tag: "family", "work", "health", "errands", or null if unclear

Return ONLY valid JSON, no markdown:
{
  "tasks": [
    {"text": "short task description", "date": "2026-07-12" or null, "tag": "family"}
  ]
}

If the text describes only one task, return an array with one item. If it's unclear or empty, return an empty array.`
    }

    if (type === "brief") {
      const todayISO = new Date().toISOString().slice(0, 10)
      const pendingTasks = (tasks || [])
        .filter((t) => !t.done)
        .slice(0, 12)
        .map((t) => {
          if (t.date) {
            const isFuture = t.date > todayISO
            const isToday = t.date === todayISO
            const dateLabel = isToday ? "TODAY" : isFuture ? `scheduled ${t.date}` : `was due ${t.date}`
            return `- ${t.text} [${dateLabel}]`
          }
          return `- ${t.text} [no date]`
        })
        .join("\n")

      const emailSummary = context.emailSummary || ""
      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      prompt = `You are Nona, a personal AI for ${context.name}, a working parent in Luxembourg.

The actual current date is ${todayStr}. Treat this as ground truth — do not reference dates, deadlines, or events from ${context.name}'s stored profile notes that have already passed relative to this date. If something in her "work focus" context mentions a future deadline, only mention it if it is still upcoming.

About ${context.name}:
- Child: ${context.child}${context.creche ? ` — today: ${context.creche}` : ""}
- Work: ${context.work || "Job search + building Nona startup"}

Pending tasks (each tagged with its date status):
${pendingTasks || "(none)"}

Email situation:
${emailSummary || "(no email data)"}

Write ONLY a short bullet list of what needs ${context.name}'s attention TODAY. No greeting, no narrative, no encouragement, no filler.

Critical distinction: a task tagged "scheduled [future date]" is something ALREADY ARRANGED that just hasn't happened yet — like a delivery, appointment, or installation that's booked. These do NOT need action today and should NOT appear in the brief unless today IS that date, or unless there's a genuine reason to double-check it (e.g. it's within 2 days and hasn't been confirmed). Do not tell her to "check status" or "confirm" something that's simply scheduled for later — that's manufacturing work that doesn't exist.

Only include: tasks tagged "TODAY", tasks tagged "was due" (overdue, needs attention), tasks with "[no date]" that are clearly things to actively do, and anything genuinely urgent from email. If a future-scheduled item is happening within the next 2 days, you may mention it as a heads-up (not an action item) — e.g. "Door installer comes Saturday" not "Confirm door installation."

Maximum 5 bullets. If there's truly nothing pressing, say so in one line. Do not invent things to fill space. Format as a plain list, one item per line, starting each with "•".`
    }

    // Use Haiku for simple structured extraction (cheap), Sonnet for brief and triage (quality matters)
    const model = (type === "parse_tasks" || type === "email_to_task")
      ? "claude-haiku-4-5-20251001"
      : "claude-sonnet-4-6"

    const message = await client.messages.create({
      model,
      max_tokens: type === "triage" ? 8000 : 1000,
      messages: [{ role: "user", content: prompt }],
    })

    const text = message.content[0].text

    if (type === "triage" || type === "parse_tasks" || type === "email_to_task") {
      try {
        const parsed = parseAIJson(text)
        return res.json(parsed)
      } catch {
        return res.status(500).json({ error: "AI returned invalid JSON — could not parse response.", raw: text.slice(0, 500) })
      }
    }

    res.json({ text })
  } catch (err) {
    console.error("AI error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
