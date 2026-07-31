-- Run this in your Supabase SQL Editor, AFTER spend-categories-migration.sql.
--
-- Fixes Amazon totals counting the same purchase several times. Amazon sends an
-- order confirmation, then dispatch/delivery updates, sometimes an invoice
-- notice — each restating the same line items. The original unique key was
-- (user_id, email_id, item_name), so every restatement was a different email_id
-- and therefore counted as another purchase.
--
-- This adds `dedupe_key`, which identifies the *purchase*: the order number when
-- the email stated one, otherwise same product on the same day. The product is
-- identified by its punctuation-stripped title rather than its ASIN — see
-- lib/spend-dedupe.js for why (an ASIN can't be recovered from every email about
-- an order, so keying on it forks the same purchase into two rows). The
-- normalisation below deliberately mirrors that file, and the two are checked
-- against each other; if either changes, change both.
--
-- Safe to re-run. It deletes rows it has determined are duplicates of another
-- row, keeping the earliest recorded one of each purchase; nothing else is
-- touched. Run the SELECT at the bottom first if you want to see what it will
-- merge before it does it.

ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- Backfill every row (including any left over from a previous partial run).
UPDATE spend_items SET dedupe_key =
  CASE
    WHEN coalesce(order_id, '') <> ''
      THEN 'o:' || lower(trim(order_id)) || '|' ||
           coalesce(
             nullif(left(regexp_replace(lower(coalesce(item_name, '')), '[^a-z0-9]+', '', 'g'), 40), ''),
             upper(trim(coalesce(asin, '')))
           )
    ELSE 'd:' || coalesce(to_char(order_date, 'YYYY-MM-DD'), '') || '|' ||
         coalesce(
           nullif(left(regexp_replace(lower(coalesce(item_name, '')), '[^a-z0-9]+', '', 'g'), 40), ''),
           upper(trim(coalesce(asin, '')))
         )
  END
WHERE dedupe_key IS NULL OR dedupe_key = '';

-- Second pass, for rows recorded before the sync started ignoring dispatch and
-- delivery emails: within a single order, treat two rows as the same purchase
-- when they share an ASIN, or when one title is a prefix of the other (an email
-- template that truncated it — "Tommee Tippee Closer to Nature Bottl…" against
-- the full title). Neither can be expressed as an equality key, hence a
-- clean-up pass rather than part of dedupe_key itself. Rewrites the later row's
-- key to the earlier row's, so the DELETE below then collapses them.
-- Loops because a chain of three emails can need more than one round; capped so
-- it always terminates.
DO $$
DECLARE
  changed INTEGER;
  rounds INTEGER := 0;
BEGIN
  LOOP
    WITH normed AS (
      SELECT id, user_id, order_id, created_at, dedupe_key,
             upper(trim(coalesce(asin, ''))) AS asin_key,
             regexp_replace(lower(coalesce(item_name, '')), '[^a-z0-9]+', '', 'g') AS name_norm
      FROM spend_items
      WHERE coalesce(order_id, '') <> ''
    ),
    matches AS (
      SELECT DISTINCT a.id, b.dedupe_key
      FROM normed a
      JOIN normed b
        ON a.user_id = b.user_id
       AND a.order_id = b.order_id
       AND a.id <> b.id
       AND a.dedupe_key <> b.dedupe_key
       AND (
             (a.asin_key <> '' AND a.asin_key = b.asin_key)
          OR (a.name_norm <> '' AND b.name_norm <> ''
              AND (a.name_norm LIKE b.name_norm || '%' OR b.name_norm LIKE a.name_norm || '%'))
       )
       AND (b.created_at < a.created_at OR (b.created_at = a.created_at AND b.id < a.id))
    )
    UPDATE spend_items s SET dedupe_key = m.dedupe_key
    FROM matches m WHERE s.id = m.id;

    GET DIAGNOSTICS changed = ROW_COUNT;
    rounds := rounds + 1;
    EXIT WHEN changed = 0 OR rounds >= 5;
  END LOOP;
END $$;

-- Collapse existing duplicates, keeping the oldest row per purchase (id as the
-- tiebreak so the result is deterministic when created_at matches).
DELETE FROM spend_items s
USING spend_items keep
WHERE s.user_id = keep.user_id
  AND s.dedupe_key = keep.dedupe_key
  AND (
    keep.created_at < s.created_at
    OR (keep.created_at = s.created_at AND keep.id < s.id)
  );

-- The old key counted one purchase once per email that mentioned it, which is
-- the bug. It also has to go rather than just being superseded: two orders in a
-- single email with the same item name are two purchases under the new key but
-- collide under the old one, which would fail the whole insert.
ALTER TABLE spend_items DROP CONSTRAINT IF EXISTS spend_items_user_id_email_id_item_name_key;

-- What the sync now upserts against.
CREATE UNIQUE INDEX IF NOT EXISTS spend_items_user_dedupe_idx ON spend_items (user_id, dedupe_key);

-- Optional check — how much was double-counted, per user. Run this BEFORE the
-- DELETE above (or after, where it should come back empty):
--   SELECT user_id, dedupe_key, count(*), sum(price)
--   FROM spend_items GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY count(*) DESC;
