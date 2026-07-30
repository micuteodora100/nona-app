-- Run this in the Supabase SQL Editor (supabase.com → your project → SQL Editor).
--
-- Fixes Gmail/Outlook reconnects failing with:
--   duplicate key value violates unique constraint "oauth_tokens_pkey"
--
-- push-setup.sql originally created oauth_tokens with PRIMARY KEY (user_id,
-- provider), where user_id is the *provider's own* email. multi-user-migration.sql
-- then made auth_user_id the real identity and added UNIQUE (auth_user_id,
-- provider) — but left the old primary key in place. The app upserts with
-- onConflict "auth_user_id,provider", and Postgres only auto-resolves conflicts
-- on the arbiter index named there; a collision on any *other* unique index is
-- raised as a hard error instead. Every reconnect (and every token refresh,
-- which calls the same saveTokens path) therefore failed once a row existed.
--
-- Atomic: if the auth_user_id NOT NULL check fails because some row was never
-- backfilled, the whole thing rolls back rather than leaving the table keyless.

BEGIN;

ALTER TABLE oauth_tokens DROP CONSTRAINT oauth_tokens_pkey;
ALTER TABLE oauth_tokens DROP CONSTRAINT IF EXISTS oauth_tokens_auth_user_id_provider_key;

-- user_id is now display-only ("connected as x@gmail.com"), never a key.
ALTER TABLE oauth_tokens ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE oauth_tokens ALTER COLUMN auth_user_id SET NOT NULL;

ALTER TABLE oauth_tokens ADD CONSTRAINT oauth_tokens_pkey PRIMARY KEY (auth_user_id, provider);

COMMIT;
