import { getSupabaseUser } from '../../../lib/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase-server'

export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' })

  const userId = user.id

  if (req.method === 'GET') {
    // Load user data from Supabase
    const { data, error } = await supabase
      .from('nona_user_data')
      .select('*')
      .eq('auth_user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      return res.status(500).json({ error: error.message })
    }

    return res.json({ data: data || null })
  }

  if (req.method === 'POST') {
    // Save user data to Supabase
    const { tasks, profile, handledEmails } = req.body

    const { error } = await supabase
      .from('nona_user_data')
      .upsert({
        auth_user_id: userId,
        user_id: user.email,
        tasks: tasks || [],
        profile: profile || {},
        handled_emails: handledEmails || [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_user_id' })

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
