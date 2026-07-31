-- Run this in your Supabase SQL Editor (after spend-tracking-setup.sql).
-- Adds product-level categorisation and product links to Amazon spend, so the
-- widget can answer "how much on diapers/milk this month" and tap through to
-- the actual Amazon product page instead of only showing one flat total.
--
-- `category` holds an id from SPEND_CATEGORIES in lib/spend-categories.js
-- (kept as plain TEXT, not an enum, so adding a category later is a code
-- change only). NULL means uncategorised — rows synced before this migration
-- start out that way and get filled in by the backfill pass in
-- pages/api/spend/sync.js on the next sync.
--
-- `asin` is Amazon's 10-character product code, recovered from the order
-- email's own product links and verified against that email before storing;
-- `product_url` is the canonical https://<marketplace>/dp/<asin> page built
-- from it. Both stay NULL when no link could be recovered, and the UI falls
-- back to an Amazon search for the item name.

ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS asin TEXT;
ALTER TABLE spend_items ADD COLUMN IF NOT EXISTS product_url TEXT;

-- Supports the per-category totals the Home widget renders for a period.
CREATE INDEX IF NOT EXISTS spend_items_user_category_idx
  ON spend_items (user_id, category, order_date DESC);

-- Lets the sync's backfill pass find rows still needing a category cheaply.
CREATE INDEX IF NOT EXISTS spend_items_uncategorized_idx
  ON spend_items (user_id) WHERE category IS NULL;
