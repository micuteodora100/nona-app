-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- Adds tables for the public marketing site:
--   1. mailing_list_subscribers — email signups from the "get updates" form
--   2. contact_messages — submissions from the /contact form
--
-- Both are written to only by server-side API routes using the service role
-- key (see lib/supabase-server.js), which bypasses RLS. No policy is granted
-- to anon/authenticated, so the tables aren't readable or writable directly
-- from the browser — only through the app's own API routes.

CREATE TABLE IF NOT EXISTS mailing_list_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  subscribed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ
);

ALTER TABLE mailing_list_subscribers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
