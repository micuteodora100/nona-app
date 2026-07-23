import { getServerSession } from "next-auth"
import { getAuthOptions } from "../auth/[...nextauth]"
import { getSupabaseServer } from "../../../lib/supabase-server"

export default async function handler(req, res) {
  const session = await getServerSession(req, res, getAuthOptions(req))
  if (!session) return res.status(401).json({ error: "Not authenticated" })

  const userId = session.user?.email
  if (!userId) return res.status(400).json({ error: "No user email" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: "Supabase not configured" })

  if (req.method === "POST") {
    const { subscription } = req.body
    if (!subscription) return res.status(400).json({ error: "Missing subscription" })

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert({ user_id: userId, subscription, created_at: new Date().toISOString() }, { onConflict: "user_id" })

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
