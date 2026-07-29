// Explicit, reviewable action schema for the natural-language command box
// (pages/app.js's "Tell Nona" box -> POST /api/ai/command). Each entry here
// is one concrete app action Claude can map a typed/spoken instruction to
// via tool-calling (Claude API tool_use) — deliberately NOT open-ended code
// execution. Keep this list small and reviewable: adding a new action means
// adding a new tool here, a matching executor in pages/app.js's
// confirmCommandAction, and (if it mutates/hides data) adding it to
// DESTRUCTIVE_ACTIONS below — not just a prompt tweak.
//
// This module has no server-only imports (no Anthropic SDK, no Supabase) so
// it's safe to import from both the API route and the client page.

export const COMMAND_TOOLS = [
  {
    name: "add_task",
    description: "Add a brand-new task/reminder. Only for something that isn't already in the task list.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Short task description." },
        date: { type: "string", description: "Resolved ISO date YYYY-MM-DD if the instruction implies one. Omit this field entirely if no date was mentioned." },
        tag: { type: "string", description: "Best-fitting category id from the provided category list. Omit if genuinely none fit." },
        summary: { type: "string", description: "One short plain-English sentence describing exactly what this action will do, shown to the user for confirmation before it happens." },
      },
      required: ["text", "summary"],
    },
  },
  {
    name: "edit_task",
    description: "Change an existing task's text, date, category, or done status. Requires picking the correct existing taskId from the provided task list — never invent one.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "id of the existing task to edit, copied exactly from the provided task list." },
        text: { type: "string", description: "New task text. Omit this field if the text should stay unchanged." },
        date: { type: "string", description: "New ISO date YYYY-MM-DD, or an empty string to clear the task's date. Omit this field if the date should stay unchanged." },
        tag: { type: "string", description: "New category id, or an empty string to clear it. Omit this field if the category should stay unchanged." },
        done: { type: "boolean", description: "true to mark the task complete, false to reopen it. Omit this field if done-status should stay unchanged." },
        summary: { type: "string", description: "One short plain-English sentence describing exactly what this action will do, shown to the user for confirmation before it happens." },
      },
      required: ["taskId", "summary"],
    },
  },
  {
    name: "delete_task",
    description: "Permanently delete an existing task. Destructive — requires picking the correct existing taskId from the provided task list, never invent one.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "id of the existing task to delete, copied exactly from the provided task list." },
        summary: { type: "string", description: "One short plain-English sentence describing exactly what this action will do, shown to the user for confirmation before it happens." },
      },
      required: ["taskId", "summary"],
    },
  },
  {
    name: "mute_sender",
    description: "Permanently hide future emails matching a sender name, address, or subject keyword from triage (adds a substring rule to the user's email filter list). Destructive-ish — easy to forget it's active, hard to notice later.",
    input_schema: {
      type: "object",
      properties: {
        sender: { type: "string", description: "Short lowercase sender name, email address, or subject keyword to filter on — not a full sentence. E.g. 'ibkr', 'no-reply@bank.com'." },
        summary: { type: "string", description: "One short plain-English sentence describing exactly what this action will do, shown to the user for confirmation before it happens." },
      },
      required: ["sender", "summary"],
    },
  },
  {
    name: "change_setting",
    description: "Change one of a small, explicit set of simple app settings.",
    input_schema: {
      type: "object",
      properties: {
        setting: { type: "string", enum: ["briefTime"], description: "Which setting to change. Only 'briefTime' (the morning brief time) is supported today." },
        value: { type: "string", description: "New value. For briefTime: 24-hour HH:MM, e.g. '08:00'." },
        summary: { type: "string", description: "One short plain-English sentence describing exactly what this action will do, shown to the user for confirmation before it happens." },
      },
      required: ["setting", "value", "summary"],
    },
  },
  {
    name: "unrecognized",
    description: "Use this whenever the instruction cannot be confidently mapped to exactly one of the other actions — including anything ambiguous (e.g. it could match more than one task), anything outside this action set entirely, or anything destructive you aren't reasonably sure about. Never guess.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Short plain-English explanation shown to the user." },
      },
      required: ["reason"],
    },
  },
]

// Actions that mutate or hide existing data in a way that's hard to notice
// or reverse later. The UI must get an explicit confirm tap for these —
// never fire them straight off a single AI guess at intent.
export const DESTRUCTIVE_ACTIONS = new Set(["delete_task", "mute_sender"])
