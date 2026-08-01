import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"

// Returns spend_items for the current user within the last `months` (default
// 12, matching the widest filter the Home widget offers), most recent first.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end()

  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(500).json({ error: "Storage not configured" })

  const months = Math.min(parseInt(req.query.months, 10) || 12, 12)
  const since = new Date()
  since.setMonth(since.getMonth() - months)
  const sinceISO = since.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from("spend_items")
    .select("*")
    .eq("user_id", user.id)
    .gte("order_date", sinceISO)
    .order("order_date", { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const rows = data || []

  // Refunds are stored as their own rows (kind='refund') rather than by
  // deleting the purchase, so the history still shows what was bought and
  // sent back. Matching them up by order+item lets the widget grey out the
  // returned purchase instead of just silently shrinking the total.
  const refundedKeys = new Set(rows.filter((r) => r.kind === "refund").map((r) => r.dedupe_key))

  const items = rows
    .filter((r) => r.kind !== "refund")
    .map((r) => ({ ...r, refunded: refundedKeys.has(r.dedupe_key) }))

  // Net of returns. Previously every row was summed unconditionally, so
  // anything sent back stayed in the total forever.
  const purchased = rows.filter((r) => r.kind !== "refund").reduce((s, r) => s + (Number(r.price) || 0), 0)
  const refunded = rows.filter((r) => r.kind === "refund").reduce((s, r) => s + (Number(r.price) || 0), 0)

  const byCategory = {}
  for (const r of rows) {
    const key = r.category || "Other"
    const amount = (Number(r.price) || 0) * (r.kind === "refund" ? -1 : 1)
    byCategory[key] = (byCategory[key] || 0) + amount
  }
  const categories = Object.entries(byCategory)
    .map(([category, total]) => ({ category, total }))
    .filter((c) => c.total !== 0)
    .sort((a, b) => b.total - a.total)

  res.json({ items, total: purchased - refunded, purchased, refunded, categories })
}
