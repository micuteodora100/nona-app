import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getSupabaseServer } from "../../../lib/supabase-server"

// Which Gmail/Outlook accounts are actually connected — read straight from
// oauth_tokens (auth_user_id), not from NextAuth's session cookie. The
// NextAuth session is per-browser and only gets populated at the moment you
// click "Connect" in *that* browser; a genuinely second device/browser that's
// logged into the same account otherwise showed "not connected" even though
// the token already existed server-side.
export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: "Supabase not configured" })

  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("provider, user_id")
    .eq("auth_user_id", user.id)

  if (error) return res.status(500).json({ error: error.message })

  const providers = {}
  for (const row of data || []) {
    providers[row.provider] = { connected: true, email: row.user_id }
  }
  return res.json({ providers })
}
