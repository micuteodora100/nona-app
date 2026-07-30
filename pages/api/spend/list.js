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

  const total = (data || []).reduce((sum, it) => sum + (Number(it.price) || 0), 0)
  res.json({ items: data || [], total })
}
