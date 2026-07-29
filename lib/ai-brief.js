import Anthropic from "@anthropic-ai/sdk"
import { DEFAULT_CATEGORIES } from "./categories"

// Triage + brief prompt-building and Anthropic call logic, factored out of
// pages/api/ai/index.js so the morning-brief cron (pages/api/cron/morning-brief.js)
// can generate the exact same triage summary / brief text a logged-in user gets
// from the "Refresh" button, instead of re-inventing the prompts. pages/api/ai/index.js
// calls these same functions for its "triage" and "brief" request types — this file is
// the one place those two prompts are defined.

export const DAILY_AI_LIMIT = parseInt(process.env.DAILY_AI_LIMIT || "200", 10)

export function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

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

function categoryListStr(categories) {
  const cats = categories?.length ? categories : DEFAULT_CATEGORIES
  return cats.map((c) => `"${c.id}" (${c.label})`).join(", ")
}

// Checks + increments today's per-user AI call count against the shared
// ANTHROPIC_API_KEY guardrail (see supabase/ai-usage-guardrail.sql). Fails
// open (logs and allows) if the RPC errors, same as the interactive route —
// a guardrail outage should never be the reason someone's brief doesn't fire.
export async function checkAiUsageLimit(supabase, userId, limit = DAILY_AI_LIMIT) {
  if (!supabase) return true
  const { data: allowed, error } = await supabase.rpc("increment_ai_usage", {
    p_user_id: userId,
    p_limit: limit,
  })
  if (error) {
    console.error("AI usage guardrail check failed:", error.message)
    return true
  }
  return allowed !== false
}

// Runs the same triage prompt the Mail tab's "Refresh" uses, given already-fetched
// emails, and returns the parsed {urgent, action, tasks, calendar_events, summary}.
export async function runTriagePrompt(client, { emails, context, categories, dismissedPatterns, existingTasks }) {
  const cats = categories?.length ? categories : DEFAULT_CATEGORIES
  const categoryList = categoryListStr(cats)

  const emailList = emails
    .map((e, i) => {
      const full = e.body || e.snippet || ""
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

  // OneNote is read-only context here — never a source of tasks/events on its
  // own, just background that can help judge whether an email matters (e.g. a
  // note already tracking something an email also mentions).
  const notesSection = context.notesSummary
    ? `\nHer recent OneNote notes, for background context only (read-only — do not extract tasks or calendar events from these, only from the emails above):\n${context.notesSummary}\n`
    : ""

  const prompt = `You are Nona, a personal AI for ${context.name}, a working parent in Luxembourg (ex-Amazon senior manager, job searching for VP roles, building a startup called Nona, child named ${context.child}).

Today's actual date is ${todayStr}. Use this as ground truth for any date reasoning.

Here are her recent emails from the last 90 days (most recent first):

${emailList}
${notesSection}
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
  "possible_duplicate_tasks": [{"text": "concrete task extracted from an email", "tag": "bills", "similar_to": "the exact existing pending task text it might be the same real-world thing as"}],
  "calendar_events": [{"text": "short event title", "date": "2026-07-03", "source_index": 1}],
  "summary": "One line: how many emails actually need attention, or 'Nothing urgent' if genuinely true."
}

Also extract calendar_events: any email that mentions a specific date + event (booking confirmation, meeting, flight, lunch, appointment, delivery) should produce a calendar event with a short title and the resolved date. Use today's date to resolve relative dates ("tomorrow", "next Tuesday"). Only extract events with a clear specific date — not vague timeframes.

Flight bookings and e-tickets need special care: create a SEPARATE calendar event for EACH leg of the trip — one for the outbound departure date, and another for the return departure date if it's a round trip (a booking confirmation email often covers both in one email, and both must be extracted, not just the first). Use the actual flight departure date, never the date the email was sent or booked. Title each one with the route and, if visible, the flight number, e.g. "✈ LGW→LIS FR1234"; fall back to "✈ Flight to [destination]" if the flight number isn't in the text.

For the tasks array: for EVERY email in urgent or action, extract at least one concrete task phrased as something to do. E.g. "Reply to Maria about contract renewal", "Pay invoice from BGL", "Confirm dentist appointment for 8 Jul". Do not leave tasks empty if there are action items. Each task needs its own "tag" — pick the single best-fitting category id from: ${categoryList}. Use null only if genuinely none fit (do not default everything to the same category — a bill and a job application are never the same tag).
${dismissedPatterns?.length ? `\nShe has previously dismissed these extracted tasks as NOT relevant (noise, not worth tracking) — don't put a substantially similar task in the tasks array again:\n${dismissedPatterns.map((t) => `- ${t}`).join("\n")}\n` : ""}
${existingTasks?.length ? `\nShe already has these tasks pending (not done yet) — some she added herself, some came from earlier emails:\n${existingTasks.map((t) => `- ${t}`).join("\n")}\n\nBefore adding a new task, check whether it's actually the same real-world thing as one already on that list (e.g. she manually noted "Appointment with BGL" and an email also confirms a BGL appointment — same thing, worded differently; or a recurring email thread like an ongoing booking back-and-forth). Three cases:\n1. Confident it's the same thing already tracked → leave it out of "tasks" entirely, don't add it anywhere.\n2. Confident it's genuinely different → add it normally to "tasks".\n3. Not sure → put it in "possible_duplicate_tasks" instead of "tasks", with "similar_to" naming the exact existing task text it might match, so she can be asked rather than you guessing wrong either way.\n` : ""}

Do not include an "fyi" bucket — if it's not worth action, don't surface it at all. Keep urgent and action arrays short — only real items, never pad them.`

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  })

  return parseAIJson(message.content[0].text)
}

// Runs the same brief prompt the Home screen's brief card uses, given the
// user's pending tasks and (optionally) an email situation summary, and
// returns the final brief text.
export async function runBriefPrompt(client, { tasks, context, categories }) {
  const cats = categories?.length ? categories : DEFAULT_CATEGORIES
  const categoryList = categoryListStr(cats)

  const todayISO = new Date().toISOString().slice(0, 10)
  const pendingTasks = (tasks || [])
    .filter((t) => !t.done && !t.notRelevant)
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

  const prompt = `You are Nona, a personal AI for ${context.name}, a working parent in Luxembourg.

The actual current date is ${todayStr}. Treat this as ground truth — do not reference dates, deadlines, or events from ${context.name}'s stored profile notes that have already passed relative to this date. If something in her "work focus" context mentions a future deadline, only mention it if it is still upcoming.

About ${context.name}:
- Child: ${context.child}${context.creche ? ` — today: ${context.creche}` : ""}
- Work: ${context.work || "Not specified"}

Pending tasks (each tagged with its category and date status):
${pendingTasks || "(none)"}

Email situation:
${emailSummary || "(no email data)"}
${context.notesSummary ? `\nHer recent OneNote notes, for background context only (never a source of items on their own — only mention something from here if it sharpens or corrects an item already coming from tasks/email above):\n${context.notesSummary}\n` : ""}
Write a short list of what needs ${context.name}'s attention TODAY, grouped under her own category names (choose from: ${categoryList}, or "Other" for anything that doesn't clearly fit one). No greeting, no narrative, no encouragement, no filler.

Critical distinction: a task tagged "scheduled [future date]" is something ALREADY ARRANGED that just hasn't happened yet — like a delivery, appointment, or installation that's booked. These do NOT need action today and should NOT appear in the brief unless today IS that date, or unless there's a genuine reason to double-check it (e.g. it's within 2 days and hasn't been confirmed). Do not tell her to "check status" or "confirm" something that's simply scheduled for later — that's manufacturing work that doesn't exist.

Only include: tasks tagged "TODAY", tasks tagged "was due" (overdue, needs attention), tasks with "[no date]" that are clearly things to actively do, and anything genuinely urgent from email. If a future-scheduled item is happening within the next 2 days, you may mention it as a heads-up (not an action item) — e.g. "Door installer comes Saturday" not "Confirm door installation."

Keep the total number of items across all groups to at most 5-6 — this is still a short daily glance, not a full task list. Do not invent things to fill space. Only show a group header if it has at least one item under it — never an empty group.

Format: for each group, one header line with just the category name (no bullet, no punctuation), followed by its items on their own lines starting with "•". If there's truly nothing pressing, respond with a single line: "• Nothing pressing today."`

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  })

  return message.content[0].text
}

// The fixed set of app actions the natural-language command box can map an
// instruction to. Kept intentionally small and explicit (not open-ended) —
// each is a real Anthropic tool, so the model must call exactly one rather
// than reply with free-form text. "unrecognized" is the deliberate escape
// hatch for anything ambiguous or referencing a task/sender that isn't in
// the context given below, instead of guessing.
const COMMAND_TOOLS = [
  {
    name: "add_tasks",
    description: "Add one or more new tasks/reminders. Use when the instruction describes something new to remember or do, not something that already exists in the current task list.",
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "Short, actionable task description" },
              date: { type: "string", description: "Resolved date as YYYY-MM-DD if a date/deadline was mentioned (relative dates like 'tomorrow' resolved against today's real date). Omit entirely if no date was mentioned." },
              tag: { type: "string", description: "Best-fitting category id from the provided category list. Omit if genuinely none fit." },
            },
            required: ["text"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "edit_task",
    description: "Change the text, date, or category of ONE existing task already in the current task list.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The exact id of the matching task, copied from the current task list — never invent one." },
        text: { type: "string", description: "New text, only if it's changing. Omit otherwise." },
        date: { type: "string", description: "New date as YYYY-MM-DD, only if it's changing. Omit otherwise." },
        tag: { type: "string", description: "New category id, only if it's changing. Omit otherwise." },
      },
      required: ["taskId"],
    },
  },
  {
    name: "complete_task",
    description: "Mark ONE existing task in the current task list as done/completed/finished.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string", description: "The exact id of the matching task, copied from the current task list." } },
      required: ["taskId"],
    },
  },
  {
    name: "dismiss_task",
    description: "Mark ONE existing task as not relevant / noise — distinct from complete_task (it isn't actually done) and from delete_task (it moves to History, fully recoverable, rather than being permanently removed). Use for phrasing like 'that's not relevant anymore', 'never mind the X task', 'I don't need to do X'.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string", description: "The exact id of the matching task, copied from the current task list." } },
      required: ["taskId"],
    },
  },
  {
    name: "delete_task",
    description: "Permanently delete ONE existing task from the current task list. Destructive — the app will ask the user to confirm before it actually happens, so it's fine to use whenever the instruction clearly asks to delete/remove/get rid of a specific existing task.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The exact id of the matching task, copied from the current task list — never invent one." },
        taskText: { type: "string", description: "That task's current text, copied exactly, so the app can show it in a confirmation prompt." },
      },
      required: ["taskId", "taskText"],
    },
  },
  {
    name: "mute_sender",
    description: "Permanently hide future emails from a sender or about a topic (e.g. 'mute IBKR', 'stop showing me LinkedIn emails'). Destructive — the app will ask the user to confirm before it actually happens.",
    input_schema: {
      type: "object",
      properties: { keyword: { type: "string", description: "A short, lowercase keyword that identifies the sender or topic — a company/sender name or distinctive word, e.g. 'ibkr', 'linkedin'. Not a full sentence." } },
      required: ["keyword"],
    },
  },
  {
    name: "unmute_sender",
    description: "Remove an existing mute/email-filter rule so that sender/topic starts showing up again. Only use when the keyword clearly matches one of the currently muted entries given in context.",
    input_schema: {
      type: "object",
      properties: { keyword: { type: "string", description: "The keyword to un-mute, matching (or closely matching) one of the currently muted entries." } },
      required: ["keyword"],
    },
  },
  {
    name: "change_setting",
    description: "Change a Nona app setting — currently the morning brief time or the voice input language.",
    input_schema: {
      type: "object",
      properties: {
        setting: { type: "string", enum: ["briefTime", "language"] },
        value: { type: "string", description: "For briefTime: 24h HH:MM, e.g. '08:00'. For language: one of en-GB, fr-FR, de-DE, ro-RO, it-IT." },
      },
      required: ["setting", "value"],
    },
  },
  {
    name: "unrecognized",
    description: "The instruction doesn't clearly map to any of the other actions — e.g. it's too vague, or it refers to a task/sender that isn't findable in the context given. Always prefer this over guessing.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "One short sentence explaining why, written for the person who typed the instruction." } },
      required: ["reason"],
    },
  },
]

// Runs the Home screen's natural-language command box: maps one instruction
// to exactly one of COMMAND_TOOLS above via real tool-calling (tool_choice
// "any" forces a tool call rather than a text reply), given just enough
// context — current open tasks, muted senders, and current settings — for
// the model to reference the right existing thing rather than invent one.
export async function runCommandPrompt(client, { instruction, tasks, categories, settings }) {
  const cats = categories?.length ? categories : DEFAULT_CATEGORIES
  const categoryList = categoryListStr(cats)

  const taskContext = (tasks || [])
    .filter((t) => !t.done && !t.notRelevant && !t.isEvent)
    .slice(0, 80)
    .map((t) => `${t.id}: "${t.text}"${t.tag ? ` [${t.tag}]` : ""}${t.date ? ` (${t.date})` : ""}`)
    .join("\n") || "(no open tasks)"

  const mutedList = (settings?.emailFilters || []).join(", ") || "(none)"
  const todayStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  const prompt = `Today's actual date is ${todayStr}.

Someone typed or spoke this instruction into Nona's command box:
"${instruction}"

Map it to exactly ONE app action by calling the single best-fitting tool. Do not reply with plain text.

Current open tasks (id: "text" [category] (date)):
${taskContext}

Currently muted senders/keywords: ${mutedList}
Current brief time: ${settings?.briefTime || "07:00"}
Current voice language: ${settings?.language || "en-GB"}
Available categories: ${categoryList}

If the instruction references an existing task or muted entry, it must match one from the lists above — never invent an id or assume a mute entry exists. If it doesn't clearly match anything, or is ambiguous, use "unrecognized" rather than guessing.`

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    tools: COMMAND_TOOLS,
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: prompt }],
  })

  const toolUse = message.content.find((b) => b.type === "tool_use")
  if (!toolUse) return { action: "unrecognized", reason: "Couldn't understand that." }
  return { action: toolUse.name, ...toolUse.input }
}
