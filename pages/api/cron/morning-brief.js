import webpush from "web-push"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { getAccessToken } from "../../../lib/tokens"
import { fetchGmailEmails, fetchOutlookEmails } from "../../../lib/email-fetch"
import { getCategories } from "../../../lib/categories"
import { getAnthropicClient, runTriagePrompt, runBriefPrompt, checkAiUsageLimit } from "../../../lib/ai-brief"

// Vercel Cron trigger for the 7am morning-brief push notification (ROADMAP.md P2).
// See vercel.json's "crons" entry for the schedule. Vercel signs every cron
// invocation with `Authorization: Bearer $CRON_SECRET`, which is checked below —
// this route must never be reachable by an unauthenticated request, since it
// fans out to every user's inbox and burns real AI budget per run.
//
// Multi-user: iterates every row in push_subscriptions (one per auth_user_id
// with push enabled), loads that user's own tasks/profile (nona_user_data) and
// their own Gmail/Outlook token (oauth_tokens, via lib/tokens.js), and sends
// each person only their own brief. One user's failure (expired token, AI
// error, malformed subscription) is caught and logged per-user so it can never
// take down the rest of the run.
//
// Email-fetch reuse: pages/api/email/gmail.js and outlook.js are the app's own
// email routes, but they're designed for a logged-in browser session (they call
// getSupabaseUser(req, res) against request cookies) — a cron invocation has no
// session to hand them. Rather than re-implementing the Gmail/Graph API calls
// here, the actual fetch logic was factored out into lib/email-fetch.js, which
// both those routes and this one now call with an already-resolved access token
// (see lib/tokens.js's getAccessToken). Same for the AI prompts: lib/ai-brief.js
// holds the exact triage/brief prompt-building + Anthropic-call logic pages/api/ai/index.js
// already used, so the push notification's text is generated the same way the
// in-app "Refresh" button generates it, not a re-invented summary.
//
// Cron-specific trimming: unlike the interactive Mail tab (90 days / up to 100
// emails per provider), this pulls a much smaller recent window before running
// triage — see EMAIL_FETCH_OPTS below — to keep total run time and AI cost
// bounded across however many users have push enabled. See "## Pending decisions"
// in the PR description for the tradeoffs here.
const EMAIL_FETCH_OPTS = { maxResults: 25, maxFullFetch: 15, maxTravelTopup: 5, maxPdfFetches: 5 }
const EMAIL_WINDOW_DAYS = 3

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.authorization
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" })
  }

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: "Supabase not configured" })

  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    console.error("morning-brief cron: VAPID_PRIVATE_KEY / NEXT_PUBLIC_VAPID_PUBLIC_KEY not configured, aborting run")
    return res.status(503).json({ error: "VAPID keys not configured" })
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )

  const { data: subscriptions, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("auth_user_id, subscription")

  if (subsError) {
    console.error("morning-brief cron: failed to load push_subscriptions:", subsError.message)
    return res.status(500).json({ error: subsError.message })
  }

  const client = getAnthropicClient()
  const results = { sent: 0, failed: 0, skipped: 0, total: subscriptions?.length || 0 }

  for (const sub of subscriptions || []) {
    const userId = sub.auth_user_id
    if (!userId || !sub.subscription) {
      // Legacy row from before the multi-user migration that was never backfilled
      // with a real auth_user_id (see supabase/multi-user-migration.sql) — nothing
      // to send to, and not this run's job to repair.
      results.skipped++
      continue
    }

    try {
      const { data: userData, error: userDataError } = await supabase
        .from("nona_user_data")
        .select("tasks, profile")
        .eq("auth_user_id", userId)
        .single()

      if (userDataError && userDataError.code !== "PGRST116") throw userDataError

      const tasks = userData?.tasks || []
      const profile = userData?.profile || {}
      const categories = getCategories(profile)
      const context = {
        name: profile.name || "there",
        child: profile.child || "your child",
        creche: profile.creche,
        work: profile.work,
        // Items dismissed off the in-app brief. They live on the profile
        // (synced via /api/sync) precisely so the push notification honours
        // them too — otherwise the 7am push would keep announcing exactly the
        // things she'd already told the app to stop showing her.
        dismissedBriefItems: profile.dismissedBriefItems || [],
      }

      // Email situation summary — best effort. Combine whichever of
      // Gmail/Outlook this user has connected into one triage call (mirrors
      // the app's own loadEmails() in pages/app.js, which merges both
      // providers before triaging once), skipped entirely if neither is
      // connected or both fetches fail.
      let emails = []
      for (const provider of ["google", "microsoft"]) {
        try {
          const accessToken = await getAccessToken(userId, provider)
          if (!accessToken) continue
          const fetchFn = provider === "google" ? fetchGmailEmails : fetchOutlookEmails
          const opts = provider === "google"
            ? { ...EMAIL_FETCH_OPTS, newerThanDays: EMAIL_WINDOW_DAYS }
            : { ...EMAIL_FETCH_OPTS, sinceDays: EMAIL_WINDOW_DAYS }
          const { emails: fetched } = await fetchFn(accessToken, opts)
          emails = emails.concat(fetched)
        } catch (err) {
          console.error(`morning-brief cron: ${provider} email fetch failed for user ${userId}:`, err.message)
        }
      }

      if (emails.length > 0) {
        const usageOk = await checkAiUsageLimit(supabase, userId)
        if (usageOk) {
          try {
            const triage = await runTriagePrompt(client, { emails, context, categories })
            context.emailSummary = triage.summary || null
          } catch (err) {
            console.error(`morning-brief cron: triage failed for user ${userId}:`, err.message)
          }
        } else {
          console.warn(`morning-brief cron: user ${userId} hit their daily AI usage limit, skipping email summary`)
        }
      }

      const usageOk = await checkAiUsageLimit(supabase, userId)
      if (!usageOk) {
        console.warn(`morning-brief cron: user ${userId} hit their daily AI usage limit, skipping brief`)
        results.skipped++
        continue
      }
      const briefText = await runBriefPrompt(client, { tasks, context, categories })

      await webpush.sendNotification(
        sub.subscription,
        JSON.stringify({
          title: "Nona — Morning brief",
          body: briefText.slice(0, 500),
          url: "/",
        })
      )
      results.sent++
    } catch (err) {
      console.error(`morning-brief cron: failed for user ${userId}:`, err.message)
      results.failed++
    }
  }

  console.log("morning-brief cron finished:", results)
  return res.json({ ok: true, ...results })
}
