-- Run this LAST, after multi-user-migration.sql has been run AND the app code
-- has been verified working end-to-end against auth_user_id (see
-- pages/api/sync, push/subscribe, lib/tokens.js). Tightens RLS from the
-- current wide-open USING (true) to a real per-user policy now that
-- auth_user_id is a genuine Supabase Auth UUID matching auth.uid().
--
-- This is a defense-in-depth backstop, not what the app depends on day to day
-- — every read/write is already scoped to the right auth_user_id in the API
-- routes, and those routes use the service-role key (bypasses RLS entirely).
-- What this closes is the latent hole ROADMAP.md flagged: today, anyone who
-- got hold of the anon/publishable key could read or write ANY row directly.

-- ── nona_user_data ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own data" ON nona_user_data;
DROP POLICY IF EXISTS "Users can write own data" ON nona_user_data;
DROP POLICY IF EXISTS "Users can update own data" ON nona_user_data;

CREATE POLICY "Users manage own data" ON nona_user_data
  FOR ALL USING (auth.uid() = auth_user_id) WITH CHECK (auth.uid() = auth_user_id);

REVOKE ALL ON nona_user_data FROM anon;

-- ── push_subscriptions ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role can do everything" ON push_subscriptions;

CREATE POLICY "Users manage own push subscription" ON push_subscriptions
  FOR ALL USING (auth.uid() = auth_user_id) WITH CHECK (auth.uid() = auth_user_id);

REVOKE ALL ON push_subscriptions FROM anon;

-- ── oauth_tokens ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role can do everything" ON oauth_tokens;

CREATE POLICY "Users manage own oauth tokens" ON oauth_tokens
  FOR ALL USING (auth.uid() = auth_user_id) WITH CHECK (auth.uid() = auth_user_id);

REVOKE ALL ON oauth_tokens FROM anon;
