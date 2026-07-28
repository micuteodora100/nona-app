import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"

export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: "Supabase not configured" })

  if (req.method === "POST") {
    const { subscription } = req.body
    if (!subscription) return res.status(400).json({ error: "Missing subscription" })

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        { auth_user_id: user.id, user_id: user.email, subscription, created_at: new Date().toISOString() },
        { onConflict: "auth_user_id" }
      )

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("push_subscriptions").delete().eq("auth_user_id", user.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
