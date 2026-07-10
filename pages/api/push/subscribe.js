import { createClient } from "@supabase/supabase-js"
import { getServerSession } from "next-auth"
import { authOptions } from "../auth/[...nextauth]"

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions)
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
