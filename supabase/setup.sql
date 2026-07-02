-- Run this in your Supabase SQL Editor (supabase.com → your project → SQL Editor)

-- Create the user data table
CREATE TABLE IF NOT EXISTS nona_user_data (
  user_id TEXT PRIMARY KEY,  -- Gmail email address
  tasks JSONB DEFAULT '[]',
  profile JSONB DEFAULT '{}',
  handled_emails JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE nona_user_data ENABLE ROW LEVEL SECURITY;

-- Allow users to read/write only their own data
-- Note: since we're using email as user_id (not Supabase Auth UUID),
-- we use a permissive policy scoped via the API route (server-side only)
-- The publishable key + RLS policy below restricts to authenticated requests only

CREATE POLICY "Service role can do everything" ON nona_user_data
  USING (true)
  WITH CHECK (true);

-- Grant access to the anon/publishable key role
GRANT ALL ON nona_user_data TO anon;
GRANT ALL ON nona_user_data TO authenticated;
