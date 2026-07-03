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
      // was: 1200 chars/email — with up to 100 emails, that made the triage
      // prompt large enough to push the whole request past Vercel's
      // serverless timeout, which is what caused "Failed to fetch." 400
      // chars still gives far more context than the original 150-char
      // snippet while keeping the whole call fast enough to finish in time.
      const emailList = emails
        .map((e, i) => `[${i + 1}] From: ${e.from}\nSubject: ${e.subject}\nContent: ${(e.body || e.snippet || "").slice(0, 400)}`)
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
  "urg
