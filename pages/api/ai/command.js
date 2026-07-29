import Anthropic from "@anthropic-ai/sdk"
import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { DEFAULT_CATEGORIES } from "../../../lib/categories"
import { COMMAND_TOOLS } from "../../../lib/actions"

const DAILY_AI_LIMIT = parseInt(process.env.DAILY_AI_LIMIT || "200", 10)

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Natural-language command box — maps a typed/spoken instruction to exactly
// one of the explicit actions in lib/actions.js via Claude tool-calling
// (forced with tool_choice "any" so the model always returns a structured
// action instead of free text, including the "unrecognized" fallback when
// it can't confidently match anything). Mirrors the auth/usage-guardrail
// pattern in pages/api/ai/index.js but kept as its own route since the tool
// use / forced tool_choice shape doesn't fit that file's plain-text-prompt
// pattern.
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

  const { instruction, tasks, categories } = req.body
  if (!instruction || !instruction.trim()) {
    return res.status(400).json({ error: "No instruction given" })
  }

  const cats = categories?.length ? categories : DEFAULT_CATEGORIES
  const categoryListStr = cats.map((c) => `"${c.id}" (${c.label})`).join(", ")

  // Give the model just enough per task to identify the right one — id/text/
  // date/tag/done — never the full task object. isEvent items are calendar
  // events auto-extracted from email, not real tasks (locked decision), so
  // they're excluded here the same way they're excluded from the Tasks tab.
  const taskList = (tasks || [])
    .filter((t) => !t.isEvent)
    .slice(0, 150)
    .map((t) => ({ id: t.id, text: t.text, date: t.date || null, tag: t.tag || null, done: !!t.done }))

  const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  const prompt = `You are Nona's command interpreter. The user typed or spoke a short instruction. Map it to exactly ONE of the available tools — never invent an action outside the provided tools, and never take a destructive or ambiguous guess.

Today's actual date is ${todayStr}. Resolve any relative dates ("tomorrow", "next Friday") against this.

The user's current tasks (id, text, date, tag, done):
${JSON.stringify(taskList)}

Category ids available for tagging: ${categoryListStr}

Instruction: "${instruction}"

Rules:
- add_task is only for a genuinely NEW task, never for editing or removing an existing one.
- For edit_task / delete_task: pick the taskId that best matches what the user described, copied exactly from the task list above. If more than one task could plausibly match, or nothing matches with real confidence, call unrecognized instead of guessing.
- For mute_sender: "sender" should be the short sender name/keyword/address the user mentioned, not a full sentence.
- For change_setting: only "briefTime" is supported today; value must be 24h "HH:MM".
- Always include "summary": one short, plain-English sentence describing exactly what will happen, to show the user for confirmation before it happens.
- If the instruction is ambiguous, out of scope for these actions, or you're not confident, call unrecognized with a short "reason" instead of guessing.`

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      tools: COMMAND_TOOLS,
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: prompt }],
    })

    const toolUse = message.content.find((b) => b.type === "tool_use")
    if (!toolUse) {
      return res.json({ action: "unrecognized", params: { reason: "Nona couldn't map that to an action." } })
    }
    return res.json({ action: toolUse.name, params: toolUse.input })
  } catch (err) {
    console.error("AI command error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
