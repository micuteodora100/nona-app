-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- Adds the two tables needed for 7am push notifications:
--   1. push_subscriptions — where to send the notification (browser push endpoint)
--   2. oauth_tokens — encrypted refresh tokens, so the cron job can read your
--      inbox at 7am without you having the app open

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id TEXT PRIMARY KEY,       -- your email (same id used in nona_user_data)
  subscription JSONB NOT NULL,    -- the browser's PushSubscription object
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can do everything" ON push_subscriptions
  USING (true) WITH CHECK (true);
GRANT ALL ON push_subscriptions TO anon;
GRANT ALL ON push_subscriptions TO authenticated;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,                 -- 'google' or 'microsoft'
  encrypted_refresh_token TEXT,           -- encrypted with ENCRYPTION_KEY, see lib/crypto.js
  encrypted_access_token TEXT,            -- cached access token, refreshed on expiry (lib/tokens.js)
  expires_at TIMESTAMPTZ,                 -- when encrypted_access_token expires
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can do everything" ON oauth_tokens
  USING (true) WITH CHECK (true);
GRANT ALL ON oauth_tokens TO anon;
GRANT ALL ON oauth_tokens TO authenticated;
