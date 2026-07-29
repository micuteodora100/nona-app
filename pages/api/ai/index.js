import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { DEFAULT_CATEGORIES } from "../../../lib/categories"

const DAILY_AI_LIMIT = parseInt(process.env.DAILY_AI_LIMIT || "200", 10)

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

  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  if (supabase) {
    const { data: allowed, error: usageError } = await supabase.rpc("increment_ai_usage", {
      p_user_id: user.id,
      p_limit: DAILY_AI_LIMIT,
    })
    if (usageError) {
      console.error("AI usage guardrail check failed:", usageError.message)
    } else if (allowed === false) {
      return res.status(429).json({ error: "Daily AI usage limit reached — try again tomorrow." })
    }
  }

  const { type, emails, tasks, context, categories } = req.body

  try {
    let prompt = ""

    // Categories are user-customizable (Settings) — always tag from whatever
    // the user currently has, not a hardcoded list, so custom categories get
    // picked up by the AI same as the defaults.
    const cats = categories?.length ? categories : DEFAULT_CATEGORIES
    const categoryListStr = cats.map(c => `"${c.id}" (${c.label})`).join(", ")

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
  "tasks": [{"text": "concrete task extracted from an email, phrased as something to do", "tag": "bills"}],
  "calendar_events": [{"text": "short event title", "date": "2026-07-03", "source_index": 1}],
  "summary": "One line: how many emails actually need attention, or 'Nothing urgent' if genuinely true."
}

Also extract calendar_events: any email that mentions a specific date + event (booking confirmation, meeting, flight, lunch, appointment, delivery) should produce a calendar event with a short title and the resolved date. Use today's date to resolve relative dates ("tomorrow", "next Tuesday"). Only extract events with a clear specific date — not vague timeframes.

Flight bookings and e-tickets need special care: create a SEPARATE calendar event for EACH leg of the trip — one for the outbound departure date, and another for the return departure date if it's a round trip (a booking confirmation email often covers both in one email, and both must be extracted, not just the first). Use the actual flight departure date, never the date the email was sent or booked. Title each one with the route and, if visible, the flight number, e.g. "✈ LGW→LIS FR1234"; fall back to "✈ Flight to [destination]" if the flight number isn't in the text.

For the tasks array: for EVERY email in urgent or action, extract at least one concrete task phrased as something to do. E.g. "Reply to Maria about contract renewal", "Pay invoice from BGL", "Confirm dentist appointment for 8 Jul". Do not leave tasks empty if there are action items. Each task needs its own "tag" — pick the single best-fitting category id from: ${categoryListStr}. Use null only if genuinely none fit (do not default everything to the same category — a bill and a job application are never the same tag).

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
- "tag": pick the single best-fitting category id from: ${categoryListStr}. Use null if genuinely none fit.

Return ONLY valid JSON, no markdown:
{"text": "short task title", "description": "one short sentence of context", "date": "2026-07-12" or null, "tag": "bills"}`
    }

    if (type === "parse_tasks") {
      const rawText = req.body.text || ""
      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      prompt = `Today's actual date is ${todayStr}.

Parse the following free text into distinct, separate tasks. The person may write multiple tasks run together, with or without explicit dates. Split them correctly even if punctuation is messy or dates are embedded mid-sentence.

Text: "${rawText}"

For each task:
- Extract a clean, short task description (remove date phrases from the text itself, keep it actionable)
- If a date is mentioned (even relative like "tomorrow", "Thursday", "next week", "the 8th"), resolve it to an actual date using today's date as reference, and include it
- If no date is mentioned, leave date as null
- Pick the single best-fitting category id for "tag" from: ${categoryListStr}. Use null if genuinely none fit.

Return ONLY valid JSON, no markdown:
{
  "tasks": [
    {"text": "short task description", "date": "2026-07-12" or null, "tag": "family"}
  ]
}

If the text describes only one task, return an array with one item. If it's unclear or empty, return an empty array.`
    }

    if (type === "email_patterns") {
      // Onboarding's inbox scan — only needs sender + subject to spot recurring
      // patterns, not full bodies, so this stays cheap even across ~100 emails.
      const emailList = (emails || [])
        .slice(0, 150)
        .map((e, i) => `[${i + 1}] From: ${e.from}\nSubject: ${e.subject}`)
        .join("\n")

      prompt = `You are scanning ${context?.name || "this person"}'s last 90 days of inbox to find genuinely recurring patterns — not to read or summarize every email.

Here is the list of emails (sender + subject only, most recent first):

${emailList}

Find the 3 to 5 MOST common and notable recurring patterns — real repeated senders or clearly repeated subject types. Examples of the kind of pattern to look for: a specific online retailer sending order confirmations repeatedly, a recurring newsletter from the same sender, repeated statements or alerts from a specific bank or financial institution, a recurring service/subscription reminder, a school or childcare provider sending regular updates.

Only include a pattern if it appears at least 3 times in the list above — do not invent a group from a one-off email.

For each pattern return:
- "label": a short, human-readable description written for the person reading it, e.g. "Frequent order confirmations from Amazon", "A recurring newsletter from TechCrunch", "Frequent statements from BGL BNP Paribas"
- "matcher": the exact lowercase text (a sender email/domain, or a short distinctive subject phrase) that would match every email in this group — this will be used as a filter rule for future emails, so keep it precise and specific to this one pattern, never a generic word
- "count": how many emails in the list above match this pattern

Return ONLY valid JSON, no markdown, no explanation:
{"groups": [{"label": "...", "matcher": "...", "count": 7}]}

If there are genuinely no repeated patterns (every email is one-off), return {"groups": []}.`
    }

    if (type === "brief") {
      const todayISO = new Date().toISOString().slice(0, 10)
      const pendingTasks = (tasks || [])
        .filter((t) => !t.done)
        .slice(0, 12)
        .map((t) => {
          const tagLabel = t.tag ? (cats.find((c) => c.id === t.tag)?.label || t.tag) : "Other"
          if (t.date) {
            const isFuture = t.date > todayISO
            const isToday = t.date === todayISO
            const dateLabel = isToday ? "TODAY" : isFuture ? `scheduled ${t.date}` : `was due ${t.date}`
            return `- [${tagLabel}] ${t.text} [${dateLabel}]`
          }
          return `- [${tagLabel}] ${t.text} [no date]`
        })
        .join("\n")

      const emailSummary = context.emailSummary || ""
      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      prompt = `You are Nona, a personal AI for ${context.name}, a working parent in Luxembourg.

The actual current date is ${todayStr}. Treat this as ground truth — do not reference dates, deadlines, or events from ${context.name}'s stored profile notes that have already passed relative to this date. If something in her "work focus" context mentions a future deadline, only mention it if it is still upcoming.

About ${context.name}:
- Child: ${context.child}${context.creche ? ` — today: ${context.creche}` : ""}
- Work: ${context.work || "Not specified"}

Pending tasks (each tagged with its category and date status):
${pendingTasks || "(none)"}

Email situation:
${emailSummary || "(no email data)"}

Write a short list of what needs ${context.name}'s attention TODAY, grouped under her own category names (choose from: ${categoryListStr}, or "Other" for anything that doesn't clearly fit one). No greeting, no narrative, no encouragement, no filler.

Critical distinction: a task tagged "scheduled [future date]" is something ALREADY ARRANGED that just hasn't happened yet — like a delivery, appointment, or installation that's booked. These do NOT need action today and should NOT appear in the brief unless today IS that date, or unless there's a genuine reason to double-check it (e.g. it's within 2 days and hasn't been confirmed). Do not tell her to "check status" or "confirm" something that's simply scheduled for later — that's manufacturing work that doesn't exist.

Only include: tasks tagged "TODAY", tasks tagged "was due" (overdue, needs attention), tasks with "[no date]" that are clearly things to actively do, and anything genuinely urgent from email. If a future-scheduled item is happening within the next 2 days, you may mention it as a heads-up (not an action item) — e.g. "Door installer comes Saturday" not "Confirm door installation."

Keep the total number of items across all groups to at most 5-6 — this is still a short daily glance, not a full task list. Do not invent things to fill space. Only show a group header if it has at least one item under it — never an empty group.

Format: for each group, one header line with just the category name (no bullet, no punctuation), followed by its items on their own lines starting with "•". If there's truly nothing pressing, respond with a single line: "• Nothing pressing today."`
    }

    // Use Haiku for simple structured extraction (cheap), Sonnet for brief, triage,
    // and email_patterns (reads across the whole 90-day inbox — quality matters,
    // and it only runs once at onboarding so cost is a non-issue)
    const model = (type === "parse_tasks" || type === "email_to_task")
      ? "claude-haiku-4-5-20251001"
      : "claude-sonnet-4-6"

    const message = await client.messages.create({
      model,
      max_tokens: type === "triage" ? 8000 : 1000,
      messages: [{ role: "user", content: prompt }],
    })

    const text = message.content[0].text

    if (type === "triage" || type === "parse_tasks" || type === "email_to_task" || type === "email_patterns") {
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
