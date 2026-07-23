import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase env vars missing — running without Supabase')
}

// createBrowserClient (not plain createClient) stores the session in cookies
// instead of localStorage — middleware.js runs at the edge and can only read
// cookies, so a localStorage-only session is invisible to it and every
// request bounces back to /login even right after a successful sign-in.
export const supabase = supabaseUrl && supabaseKey
  ? createBrowserClient(supabaseUrl, supabaseKey)
  : null
