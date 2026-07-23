import { getServerSession } from 'next-auth'
import { getAuthOptions } from '../auth/[...nextauth]'
import { getSupabaseServer } from '../../../lib/supabase-server'

export default async function handler(req, res) {
  const session = await getServerSession(req, res, getAuthOptions(req))
  if (!session) return res.status(401).json({ error: 'Not authenticated' })

  const supabase = getSupabaseServer()
  if (!supabase) return res.status(503).json({ error: 'Supabase not configured' })

  // Use email as the user identifier (from Gmail OAuth)
  const userId = session.user?.email
  if (!userId) return res.status(400).json({ error: 'No user email' })

  if (req.method === 'GET') {
    // Load user data from Supabase
    const { data, error } = await supabase
      .from('nona_user_data')
      .select('*')
      .eq('user_id', userId)
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
        user_id: userId,
        tasks: tasks || [],
        profile: profile || {},
        handled_emails: handledEmails || [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true })
  }

  res.status(405).end()
}
