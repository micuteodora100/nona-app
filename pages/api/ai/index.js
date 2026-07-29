import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { DEFAULT_CATEGORIES } from "../../../lib/categories"
import { DAILY_AI_LIMIT, getAnthropicClient, runTriagePrompt, runBriefPrompt } from "../../../lib/ai-brief"

const client = getAnthropicClient()

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

  // triage and brief now share their prompt-building + call logic with the
  // morning-brief cron (lib/ai-brief.js) rather than each defining it inline here.
  if (type === "triage") {
    try {
      const parsed = await runTriagePrompt(client, { emails, context, categories })
      return res.json(parsed)
    } catch (err) {
      console.error("AI error:", err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  if (type === "brief") {
    try {
      const text = await runBriefPrompt(client, { tasks, context, categories })
      return res.json({ text })
    } catch (err) {
      console.error("AI error:", err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  try {
    let prompt = ""

    // Categories are user-customizable (Settings) — always tag from whatever
    // the user currently has, not a hardcoded list, so custom categories get
    // picked up by the AI same as the defaults.
    const cats = categories?.length ? categories : DEFAULT_CATEGORIES
    const categoryListStr = cats.map(c => `"${c.id}" (${c.label})`).join(", ")

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

    // Both remaining types (parse_tasks, email_to_task) use Haiku — cheap structured extraction.
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    })

    const text = message.content[0].text

    try {
      const parsed = parseAIJson(text)
      return res.json(parsed)
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON — could not parse response.", raw: text.slice(0, 500) })
    }
  } catch (err) {
    console.error("AI error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
