import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"
import { getAccessToken } from "../../../lib/tokens"
import {
  fetchAmazonGmailEmails, fetchAmazonOutlookEmails,
  fetchLidlGmailEmails, fetchLidlOutlookEmails,
  fetchCactusGmailEmails, fetchCactusOutlookEmails,
} from "../../../lib/email-fetch"
import { runAmazonExtractPrompt, runSimpleRetailerExtractPrompt, runSpendCategorizePrompt } from "../../../lib/spend-extract"
import { getAnthropicClient } from "../../../lib/ai-brief"
import { validSpendCategory, amazonProductUrl, isAsin } from "../../../lib/spend-categories"
import { spendDedupeKey } from "../../../lib/spend-dedupe"

const client = getAnthropicClient()

// Rows to categorise per sync when backfilling history recorded before
// categories existed — capped so one sync can't fan out into an unbounded
// number of AI calls; repeated syncs work through the rest.
const BACKFILL_LIMIT = 200

// One retailer's sync: fetch already-seen email_ids for `source`, extract line
// items from whatever's new, dedupe, upsert. Wrapped per-retailer in the
// handler below so one retailer's extraction failing (bad data, API error)
// can't take the other two down with it.
async function syncRetailerOrders(supabase, user, { source, emails, extractFn, buildRow }) {
  const { data: existingRows } = await supabase
    .from("spend_items")
    .select("email_id")
    .eq("user_id", user.id)
    .eq("source", source)
  const seenEmailIds = new Set((existingRows || []).map((r) => r.email_id))

  const newEmails = emails.filter((e) => !seenEmailIds.has(e.id))
  let inserted = 0
  let skippedRestatements = 0

  if (newEmails.length > 0) {
    const extracted = await extractFn(newEmails)
    const items = extracted.filter((it) => it.email_kind === "order_confirmation")
    skippedRestatements = extracted.length - items.length

    if (items.length > 0) {
      const emailById = new Map(newEmails.map((e) => [e.id, e]))
      const rows = items.map((it) => {
        const email = emailById.get(it.email_id)
        const row = buildRow(it, email)
        return { ...row, dedupe_key: spendDedupeKey(row) }
      })
      // Two identical keys inside one batch would make Postgres reject the
      // whole upsert ("cannot affect row a second time"), and one email can
      // legitimately list the same product twice.
      const byKey = new Map()
      for (const row of rows) byKey.set(row.dedupe_key, row)
      const uniqueRows = [...byKey.values()]

      const { error, count } = await supabase
        .from("spend_items")
        .upsert(uniqueRows, { onConflict: "user_id,dedupe_key", count: "exact" })
      if (error) throw new Error(error.message)
      inserted = count || uniqueRows.length
    }
  }

  return { scanned: emails.length, newEmails: newEmails.length, inserted, skippedRestatements }
}

// Pulls order emails for Amazon, Lidl and Cactus from every connected
// provider (12mo backfill each), skips ones already synced (by email_id),
// extracts line items via AI, and stores new rows. Safe to call repeatedly —
// dedup happens both before the AI call (skip already-seen email_ids) and at
// insert time (unique constraint on user_id+dedupe_key).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end()

  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(500).json({ error: "Storage not configured" })

  const googleToken = await getAccessToken(user.id, "google")
  const microsoftToken = await getAccessToken(user.id, "microsoft")
  if (!googleToken && !microsoftToken) {
    return res.status(401).json({ error: "Connect Gmail or Outlook first to sync spend" })
  }

  try {
    const [amazonGmail, lidlGmail, cactusGmail] = googleToken
      ? await Promise.all([
          fetchAmazonGmailEmails(googleToken, { newerThanDays: 365 }),
          fetchLidlGmailEmails(googleToken, { newerThanDays: 365 }),
          fetchCactusGmailEmails(googleToken, { newerThanDays: 365 }),
        ])
      : [{ emails: [] }, { emails: [] }, { emails: [] }]

    const [amazonOutlook, lidlOutlook, cactusOutlook] = microsoftToken
      ? await Promise.all([
          fetchAmazonOutlookEmails(microsoftToken, { sinceDays: 365 }),
          fetchLidlOutlookEmails(microsoftToken, { sinceDays: 365 }),
          fetchCactusOutlookEmails(microsoftToken, { sinceDays: 365 }),
        ])
      : [{ emails: [] }, { emails: [] }, { emails: [] }]

    const retailers = {
      amazon: {
        emails: [...amazonGmail.emails, ...amazonOutlook.emails],
        extractFn: (emails) => runAmazonExtractPrompt(client, emails),
        buildRow: (it, email) => {
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
        },
      },
      lidl: {
        emails: [...lidlGmail.emails, ...lidlOutlook.emails],
        extractFn: (emails) => runSimpleRetailerExtractPrompt(client, emails, { retailerName: "Lidl" }),
        buildRow: (it) => ({
          user_id: user.id,
          source: "lidl",
          email_id: it.email_id,
          order_id: it.order_id,
          item_name: it.item_name,
          category: validSpendCategory(it.category),
          asin: null,
          product_url: null,
          price: it.price,
          currency: it.currency,
          order_date: it.order_date,
        }),
      },
      cactus: {
        emails: [...cactusGmail.emails, ...cactusOutlook.emails],
        extractFn: (emails) => runSimpleRetailerExtractPrompt(client, emails, { retailerName: "Cactus" }),
        buildRow: (it) => ({
          user_id: user.id,
          source: "cactus",
          email_id: it.email_id,
          order_id: it.order_id,
          item_name: it.item_name,
          category: validSpendCategory(it.category),
          asin: null,
          product_url: null,
          price: it.price,
          currency: it.currency,
          order_date: it.order_date,
        }),
      },
    }

    const results = {}
    const errors = {}
    for (const [source, config] of Object.entries(retailers)) {
      try {
        results[source] = await syncRetailerOrders(supabase, user, { source, ...config })
      } catch (err) {
        console.error(`${source} spend sync error:`, err.message)
        errors[source] = err.message
        results[source] = { scanned: config.emails.length, newEmails: 0, inserted: 0, skippedRestatements: 0 }
      }
    }

    // Backfill: rows stored before categories existed have category = null and
    // would otherwise sit in the breakdown as "Uncategorised" forever, since
    // their emails are already marked as seen and never re-extracted. Product
    // names alone are enough to classify them (no email needed), so one sync
    // makes the breakdown cover her whole history, not just new orders. Runs
    // across all sources — this query has never filtered by source.
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

    res.json({
      scanned: Object.values(results).reduce((s, r) => s + r.scanned, 0),
      newEmails: Object.values(results).reduce((s, r) => s + r.newEmails, 0),
      inserted: Object.values(results).reduce((s, r) => s + r.inserted, 0),
      skippedRestatements: Object.values(results).reduce((s, r) => s + r.skippedRestatements, 0),
      categorized,
      bySource: results,
      ...(Object.keys(errors).length ? { errors } : {}),
    })
  } catch (err) {
    console.error("Spend sync error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
