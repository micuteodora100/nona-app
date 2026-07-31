import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { DAILY_AI_LIMIT, getAnthropicClient, runTriagePrompt, runBriefPrompt, runCommandPrompt, categoryListStr } from "../../../lib/ai-brief"

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

  const { type, emails, tasks, context, categories, instruction, settings, dismissedPatterns, existingTasks } = req.body

  // Natural-language command box (Home screen's speak-or-type capture): maps
  // free text to exactly one of a fixed set of app actions via real Anthropic
  // tool-calling (tool_choice "any" forces a tool call, never free text), so
  // the result is always one of these known shapes rather than parsed prose.
  // The client applies non-destructive actions immediately and confirms
  // before firing delete_task / mute_sender.
  if (type === "command") {
    try {
      const parsed = await runCommandPrompt(client, { instruction, tasks, categories, settings })
      return res.json(parsed)
    } catch (err) {
      console.error("AI error:", err.message)
      return res.status(500).json({ error: err.message })
    }
  }

  // triage and brief now share their prompt-building + call logic with the
  // morning-brief cron (lib/ai-brief.js) rather than each defining it inline here.
  if (type === "triage") {
    try {
      const parsed = await runTriagePrompt(client, { emails, context, categories, dismissedPatterns, existingTasks })
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
    const catList = categoryListStr(categories)

    // Self-training feedback loop: tasks the person has explicitly dismissed
    // as "not relevant" (as opposed to genuinely completed) get remembered
    // (pages/app.js's markNotRelevant, capped at 30) so repeatedly-dismissed
    // patterns stop resurfacing — same idea as sender muting, but for tasks.
    const dismissedSection = dismissedPatterns?.length
      ? `\nThe person has previously dismissed these as NOT relevant (noise, not something to track) — don't suggest a new task substantially similar to any of these:\n${dismissedPatterns.map(t => `- ${t}`).join("\n")}\n`
      : ""

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
${dismissedSection}
Rules:
- "text": a short, specific task title (under 10 words if possible) describing what the recipient needs to DO — not a summary. E.g. "Reply to Maria about contract" not "Email from Maria about contract."
- "description": one short sentence (under 20 words) giving context — what the email is actually about, so the task makes sense without reopening the email.
- "date": if the email mentions any date, deadline, or appointment (even relative like "by Friday" or "next week"), resolve it to an actual date using today as reference. If genuinely no date is mentioned, use null.
- "tag": pick the single best-fitting category id from: ${catList}. Use null if genuinely none fit.

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
- Extract a clean, short task description (remove date and time phrases from the text itself, keep it actionable)
- If a date is mentioned (even relative like "tomorrow", "Thursday", "next week", "the 8th"), resolve it to an actual date using today's date as reference, and include it
- If no date is mentioned, leave date as null
- If a time of day is mentioned ("at 3", "3pm", "half past four", "10:30 in the morning"), resolve it to 24-hour "HH:MM" as "time". If a duration or end time is mentioned ("for an hour", "3 to 4pm", "2pm-3:30"), also set "endTime" to the 24-hour end time. Leave either as null when not mentioned — never invent a time.
- Pick the single best-fitting category id for "tag" from: ${catList}. Use null if genuinely none fit.

Return ONLY valid JSON, no markdown:
{
  "tasks": [
    {"text": "short task description", "date": "2026-07-12" or null, "time": "15:00" or null, "endTime": "16:00" or null, "tag": "family"}
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

    // Remaining types reaching here: parse_tasks, email_to_task (cheap structured
    // extraction, Haiku) and email_patterns (reads across the whole 90-day inbox —
    // quality matters, and it only runs once at onboarding so cost is a non-issue, Sonnet).
    const model = (type === "email_patterns")
      ? "claude-sonnet-4-6"
      : "claude-haiku-4-5-20251001"

    const message = await client.messages.create({
      model,
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
