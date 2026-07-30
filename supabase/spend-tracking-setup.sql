-- Run this in your Supabase SQL Editor.
-- Adds spend tracking (Amazon first; Lidl/Cactus to follow the same shape
-- later per ROADMAP.md's budget-dashboard rows). Each row is one line item
-- pulled from an order-confirmation email — one email can produce several
-- rows (multi-item Amazon orders).

CREATE TABLE IF NOT EXISTS spend_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'amazon',
  email_id TEXT NOT NULL,
  order_id TEXT,
  item_name TEXT NOT NULL,
  price NUMERIC,
  currency TEXT DEFAULT 'EUR',
  order_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Same email re-synced (12mo backfill window overlaps every sync) must not
  -- duplicate rows — one item name can legitimately repeat across different
  -- emails, so the dedup key includes email_id, not just user+item.
  UNIQUE (user_id, email_id, item_name)
);

CREATE INDEX IF NOT EXISTS spend_items_user_date_idx ON spend_items (user_id, order_date DESC);

ALTER TABLE spend_items ENABLE ROW LEVEL SECURITY;

-- Matches the tightened pattern already used for oauth_tokens/nona_user_data
-- (see rls-tightening.sql): API routes use the service-role key and scope
-- every query by user.id themselves, this is the defense-in-depth backstop.
CREATE POLICY "Users manage own spend items" ON spend_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON spend_items FROM anon;
GRANT ALL ON spend_items TO authenticated;
GRANT ALL ON spend_items TO service_role;
