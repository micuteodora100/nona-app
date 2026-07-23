import { createClient } from "@supabase/supabase-js"

// Server-side Supabase client — uses the service role key so RLS is bypassed
// for these trusted, server-only operations. Falls back to null if not configured.
export function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}
