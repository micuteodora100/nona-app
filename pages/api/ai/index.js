import Anthropic from "@anthropic-ai/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "../auth/[...nextauth]"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: "Not authenticated" })

  const { type, emails, tasks, context } = req.body

  try {
    let prompt = ""

    if (type === "triage") {
      const emailList = emails
        .map((e, i) => `[${i + 1}] From: ${e.from}\nSubject: ${e.subject}\nPreview: ${(e.snippet || "").slice(0, 150)}`)
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
  "summary": "One line: how many emails actually need attention, or 'Nothing urgent' if genuinely true."
}

Do not include an "fyi" bucket — if it's not worth action, don't surface it at all. Keep urgent and action arrays short — only real items, never pad them.`
    }

    if (type === "email_to_task") {
      const email = req.body.email || {}
      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      prompt = `Today's actual date is ${todayStr}.

Turn this email into ONE clear, actionable task for the recipient.

From: ${email.from}
Subject: ${email.subject}
Content: ${email.snippet}

Rules:
- Write a short, specific task description (under 10 words if possible) describing what the recipient needs to DO — not a summary of the email. E.g. "Reply to Maria about contract" not "Email from Maria about contract."
- If the email mentions any date, deadline, or appointment (even relative like "by Friday" or "next week"), resolve it to an actual date using today as reference and include it. If genuinely no date is mentioned, use null.
- Guess a tag: "family", "work", "health", "errands", or null if unclear.

Return ONLY valid JSON, no markdown:
{"text": "short task description", "date": "2026-07-12" or null, "tag": "work"}`
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
      const pendingTasks = (tasks || [])
        .filter((t) => !t.done)
        .slice(0, 8)
        .map((t) => `- ${t.text}`)
        .join("\n")

      const emailSummary = context.emailSummary || ""
      const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

      prompt = `You are Nona, a personal AI for ${context.name}, a working parent in Luxembourg.

The actual current date is ${todayStr}. Treat this as ground truth — do not reference dates, deadlines, or events from ${context.name}'s stored profile notes that have already passed relative to this date. If something in her "work focus" context mentions a future deadline, only mention it if it is still upcoming.

About ${context.name}:
- Child: ${context.child}${context.creche ? ` — today: ${context.creche}` : ""}
- Work: ${context.work || "Job search + building Nona startup"}

Pending tasks:
${pendingTasks || "(none)"}

Email situation:
${emailSummary || "(no email data)"}

Write ONLY a short bullet list of what needs ${context.name}'s attention today. No greeting, no narrative, no encouragement, no filler. Each line should be one concrete, specific action — pulled from her tasks and emails, in priority order. Maximum 5 bullets. If there's truly nothing pressing, say so in one line. Do not invent things to fill space. Format as a plain list, one item per line, starting each with "•".`
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    })

    const text = message.content[0].text

    if (type === "triage" || type === "parse_tasks" || type === "email_to_task") {
      try {
        const parsed = JSON.parse(text)
        return res.json(parsed)
      } catch {
        return res.json({ error: "Parse failed", raw: text })
      }
    }

    res.json({ text })
  } catch (err) {
    console.error("AI error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
