-- Run this in the Supabase SQL Editor after multi-user-migration.sql.
-- Minimal per-user daily cap on AI requests (triage/brief/task parsing), so
-- one account can't silently burn the whole shared ANTHROPIC_API_KEY budget
-- once a second person is using the app. Checked in pages/api/ai/index.js.

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  auth_user_id UUID REFERENCES auth.users(id),
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (auth_user_id, day)
);

ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated grants — only the server route (service-role key,
-- which bypasses RLS/grants entirely) ever touches this table.

CREATE OR REPLACE FUNCTION increment_ai_usage(p_user_id uuid, p_limit int)
RETURNS boolean AS $$
DECLARE
  current_count int;
BEGIN
  INSERT INTO ai_usage_daily (auth_user_id, day, count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (auth_user_id, day) DO UPDATE SET count = ai_usage_daily.count + 1
  RETURNING count INTO current_count;

  RETURN current_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
