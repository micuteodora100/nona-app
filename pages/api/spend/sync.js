import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { getAccessToken } from "../../../lib/tokens"
import { fetchAmazonGmailEmails, fetchAmazonOutlookEmails } from "../../../lib/email-fetch"
import { runAmazonExtractPrompt, runSpendCategorizePrompt } from "../../../lib/spend-extract"
import { getAnthropicClient } from "../../../lib/ai-brief"
import { validSpendCategory, amazonProductUrl, isAsin } from "../../../lib/spend-categories"

const client = getAnthropicClient()

// Rows to categorise per sync when backfilling history recorded before
// categories existed — capped so one sync can't fan out into an unbounded
// number of AI calls; repeated syncs work through the rest.
const BACKFILL_LIMIT = 200

// Pulls Amazon order emails from every connected provider (12mo backfill),
// skips ones already synced (by email_id), extracts line items via AI, and
// stores new rows. Safe to call repeatedly — dedup happens both before the
// AI call (skip already-seen email_ids) and at insert time (unique
// constraint on user_id+email_id+item_name).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(500).json({ error: "Storage not configured" })

  try {
    const { data: existingRows } = await supabase
      .from("spend_items")
      .select("email_id")
      .eq("user_id", user.id)
      .eq("source", "amazon")
    const seenEmailIds = new Set((existingRows || []).map((r) => r.email_id))

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
        const emailById = new Map(newEmails.map((e) => [e.id, e]))
        const rows = items.map((it) => {
          const email = emailById.get(it.email_id)
          // Only trust an ASIN that genuinely appeared in that email's own
          // product links — a hallucinated code would deep-link to the wrong
          // product, which is worse than falling back to a name search.
          const claimed = typeof it.asin === "string" ? it.asin.trim().toUpperCase() : ""
          const asin = isAsin(claimed) && (email?.asins || []).includes(claimed) ? claimed : null
          return {
            user_id: user.id,
            source: "amazon",
            email_id: it.email_id,
            order_id: it.order_id,
            item_name: it.item_name,
            category: validSpendCategory(it.category),
            asin,
            product_url: amazonProductUrl(asin, email?.amazonDomain),
            price: it.price,
            currency: it.currency,
            order_date: it.order_date,
          }
        })
        const { error, count } = await supabase
          .from("spend_items")
          .upsert(rows, { onConflict: "user_id,email_id,item_name", count: "exact" })
        if (error) {
          console.error("spend_items insert error:", error.message, error.details || "")
          return res.status(500).json({ error: error.message })
        }
        inserted = count || rows.length
      }
    }

    // Backfill: rows stored before categories existed have category = null and
    // would otherwise sit in the breakdown as "Uncategorised" forever, since
    // their emails are already marked as seen and never re-extracted. Product
    // names alone are enough to classify them (no email needed), so one sync
    // makes the breakdown cover her whole history, not just new orders.
    let categorized = 0
    const { data: uncategorized } = await supabase
      .from("spend_items")
      .select("id, item_name")
      .eq("user_id", user.id)
      .is("category", null)
      .limit(BACKFILL_LIMIT)

    if (uncategorized?.length) {
      const assigned = await runSpendCategorizePrompt(client, uncategorized)
      for (const [id, category] of assigned) {
        const valid = validSpendCategory(category)
        if (!valid) continue
        const { error } = await supabase
          .from("spend_items")
          .update({ category: valid })
          .eq("id", id)
          .eq("user_id", user.id)
        if (!error) categorized++
      }
    }

    res.json({ scanned: rawEmails.length, newEmails: newEmails.length, inserted, categorized })
  } catch (err) {
    console.error("Amazon spend sync error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
