import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { getAccessToken } from "../../../lib/tokens"
import { fetchAmazonGmailEmails, fetchAmazonOutlookEmails } from "../../../lib/email-fetch"
import { runAmazonExtractPrompt } from "../../../lib/spend-extract"
import { getAnthropicClient } from "../../../lib/ai-brief"

const client = getAnthropicClient()

// Pulls Amazon order emails from every connected provider (12mo backfill),
// skips ones already synced (by email_id), extracts line items via AI, and
// stores new rows. Safe to call repeatedly — dedup happens before the AI call
// (skip already-seen email_ids), inside the extractor (collapse by order
// number within a run), and at insert time (unique constraint on
// user_id+kind+dedupe_key). See supabase/spend-tracking-v2.sql for why the
// key is the Amazon order number rather than the email's own id.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(500).json({ error: "Storage not configured" })

  try {
    // Every email already put through extraction, not just the ones that
    // produced a row — see spend_synced_emails in supabase/spend-tracking-v2.sql.
    const { data: seenRows } = await supabase
      .from("spend_synced_emails")
      .select("email_id")
      .eq("user_id", user.id)
    const seenEmailIds = new Set((seenRows || []).map((r) => r.email_id))

    let rawEmails = []

    const googleToken = await getAccessToken(user.id, "google")
    if (googleToken) {
      const { emails } = await fetchAmazonGmailEmails(googleToken, { newerThanDays: 365 })
      rawEmails.push(...emails)
    }

    const microsoftToken = await getAccessToken(user.id, "microsoft")
    if (microsoftToken) {
      const { emails } = await fetchAmazonOutlookEmails(microsoftToken, { sinceDays: 365 })
      rawEmails.push(...emails)
    }

    if (!googleToken && !microsoftToken) {
      return res.status(401).json({ error: "Connect Gmail or Outlook first to sync Amazon spend" })
    }

    const newEmails = rawEmails.filter((e) => !seenEmailIds.has(e.id))

    let inserted = 0
    if (newEmails.length > 0) {
      const items = await runAmazonExtractPrompt(client, newEmails)
      if (items.length > 0) {
        const rows = items.map((it) => ({
          user_id: user.id,
          source: "amazon",
          email_id: it.email_id,
          order_id: it.order_id,
          kind: it.kind,
          item_name: it.item_name,
          price: it.price,
          currency: it.currency,
          order_date: it.order_date,
          category: it.category,
          dedupe_key: it.dedupe_key,
        }))
        const { error, count } = await supabase
          .from("spend_items")
          .upsert(rows, { onConflict: "user_id,kind,dedupe_key", count: "exact" })
        if (error) {
          console.error("spend_items insert error:", error.message, error.details || "")
          return res.status(500).json({ error: error.message })
        }
        inserted = count || rows.length
      }

      // Only marked as seen once the rows above are safely stored, so a failed
      // insert leaves the emails eligible for the next sync rather than
      // silently dropping those purchases forever.
      const { error: seenError } = await supabase
        .from("spend_synced_emails")
        .upsert(
          newEmails.map((e) => ({ user_id: user.id, email_id: e.id })),
          { onConflict: "user_id,email_id" }
        )
      if (seenError) console.error("spend_synced_emails insert error:", seenError.message)
    }

    res.json({ scanned: rawEmails.length, newEmails: newEmails.length, inserted })
  } catch (err) {
    console.error("Amazon spend sync error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
