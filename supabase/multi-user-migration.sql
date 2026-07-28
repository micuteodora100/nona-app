-- Run this in the Supabase SQL Editor (supabase.com → your project → SQL Editor).
-- Part of the multi-user identity migration: nona_user_data / push_subscriptions /
-- oauth_tokens were keyed by whichever NextAuth OAuth email was "current", not by
-- the Supabase Auth identity someone actually logged in as. This adds a real
-- auth_user_id column (Supabase Auth's UUID) alongside the old email-keyed
-- user_id, backfilled by email match. Purely additive — nothing is dropped here,
-- and the app doesn't read auth_user_id until the matching code change ships.

-- ── nona_user_data ──────────────────────────────────────────────────────────
ALTER TABLE nona_user_data ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);

UPDATE nona_user_data d
SET auth_user_id = u.id
FROM auth.users u
WHERE d.auth_user_id IS NULL AND lower(d.user_id) = lower(u.email);

ALTER TABLE nona_user_data
  ADD CONSTRAINT nona_user_data_auth_user_id_key UNIQUE (auth_user_id);

-- ── push_subscriptions ──────────────────────────────────────────────────────
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);

UPDATE push_subscriptions d
SET auth_user_id = u.id
FROM auth.users u
WHERE d.auth_user_id IS NULL AND lower(d.user_id) = lower(u.email);

ALTER TABLE push_subscriptions
  ADD CONSTRAINT push_subscriptions_auth_user_id_key UNIQUE (auth_user_id);

-- ── oauth_tokens ─────────────────────────────────────────────────────────────
-- Keyed by (user_id, provider) since one person can connect more than one
-- provider — auth_user_id gets the same treatment, unique per (auth_user_id, provider).
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);

UPDATE oauth_tokens d
SET auth_user_id = u.id
FROM auth.users u
WHERE d.auth_user_id IS NULL AND lower(d.user_id) = lower(u.email);

ALTER TABLE oauth_tokens
  ADD CONSTRAINT oauth_tokens_auth_user_id_provider_key UNIQUE (auth_user_id, provider);

-- NOTE: the email-match backfill above only catches rows where the OAuth
-- provider's own email happens to equal a Supabase Auth login email. A second
-- connected provider under a *different* email (e.g. Outlook connected under
-- an address that isn't your Supabase Auth login) will be left with
-- auth_user_id = NULL here and needs a manual one-off UPDATE — see
-- scripts/_inspect-migration.js output and the one-off fix run alongside this
-- migration for Teodora's specific Outlook row.
