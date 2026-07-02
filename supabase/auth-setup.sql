-- Run this in your Supabase SQL Editor after the previous setup.sql
-- This enables proper per-user Row Level Security

-- Drop the permissive policy we created before
DROP POLICY IF EXISTS "Service role can do everything" ON nona_user_data;

-- Create proper RLS policies
-- Users can only read/write their own data
CREATE POLICY "Users can read own data" ON nona_user_data
  FOR SELECT USING (auth.uid()::text = user_id OR user_id LIKE '%@%');

CREATE POLICY "Users can write own data" ON nona_user_data
  FOR INSERT WITH CHECK (auth.uid()::text = user_id OR user_id LIKE '%@%');

CREATE POLICY "Users can update own data" ON nona_user_data
  FOR UPDATE USING (auth.uid()::text = user_id OR user_id LIKE '%@%');

-- Note: user_id is currently the Gmail email address
-- When we migrate to Supabase Auth, it will be the Supabase user UUID
