-- Run this in your Supabase SQL Editor, after spend-tracking-setup.sql.
--
-- Fixes three things about Amazon spend tracking:
--
-- 1. Duplicates. The old dedup key was (user_id, email_id, item_name). Amazon
--    sends several emails per order — confirmation, dispatched, delivered,
--    sometimes an invoice — and each has a different message id, so a single
--    purchase produced a row per email. The same order arriving in both a
--    connected Gmail and a connected Outlook did it again. The new key is
--    `dedupe_key`, built in lib/spend-extract.js from the Amazon *order
--    number* + item name (falling back to the email id only when the email
--    shows no order number), which is stable across all of those.
--
-- 2. Returns. There was no concept of one: a refunded item stayed in the
--    total forever. Rows now carry `kind` ('purchase' or 'refund') and
--    pages/api/spend/list.js nets refunds off the total.
--
-- 3. Categories. There was no category column and nothing in the extraction
--    asked for one, which is why everything showed as uncategorized.
--
-- Existing rows are deleted rather than migrated: they were extracted without
-- categories or refund detection and with the duplicates already baked in, so
-- re-running Sync against the corrected logic gives a clean 12-month history.
-- Press "↺ Sync" on the Home tab once after running this.

DELETE FROM spend_items;

ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'purchase';
ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- One row per (person, purchase-or-refund, order+item). `kind` is part of the
-- key so a refund for an item never collides with the purchase it reverses.
ALTER TABLE spend_items DROP CONSTRAINT IF EXISTS spend_items_user_id_email_id_item_name_key;
ALTER TABLE spend_items DROP CONSTRAINT IF EXISTS spend_items_user_kind_dedupe_key;
ALTER TABLE spend_items ADD CONSTRAINT spend_items_user_kind_dedupe_key UNIQUE (user_id, kind, dedupe_key);

-- Backfill safety for any row inserted before dedupe_key existed, so the
-- constraint above can never be satisfied by a NULL (NULLs don't conflict in
-- Postgres, which would silently let duplicates back in).
UPDATE spend_items
SET dedupe_key = COALESCE(dedupe_key, 'e:' || email_id || '::' || lower(item_name))
WHERE dedupe_key IS NULL;

ALTER TABLE spend_items ALTER COLUMN dedupe_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS spend_items_user_kind_idx ON spend_items (user_id, kind);

-- Which Amazon emails have already been through extraction, regardless of
-- whether they produced any rows. Previously "already synced" was inferred
-- from spend_items.email_id, which only ever contains emails that yielded an
-- item — so every shipping notification, delivery update and marketing email
-- was re-sent to the AI on every single sync, forever. Now that shipping
-- updates deliberately produce no rows, that would have been most of the
-- inbox.
CREATE TABLE IF NOT EXISTS spend_synced_emails (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, email_id)
);

ALTER TABLE spend_synced_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own synced spend emails" ON spend_synced_emails
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON spend_synced_emails FROM anon;
GRANT ALL ON spend_synced_emails TO authenticated;
GRANT ALL ON spend_synced_emails TO service_role;
