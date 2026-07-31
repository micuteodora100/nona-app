// One purchase can be described by several emails — Amazon sends an order
// confirmation, then "dispatched", then "delivered", sometimes an invoice
// notice, each restating the same line items. The original dedupe key was
// (user_id, email_id, item_name), which treats every one of those as a new
// purchase, so a single €35 pack of nappies could land in the totals three or
// four times. This computes a key that identifies the *purchase* instead of
// the email that mentioned it.
//
// Deliberately deterministic and AI-free: the model classifying an email as a
// shipping update is a useful first filter (see spend-extract.js), but it can't
// be the only one, because a single misclassification silently inflates the
// budget with no way to notice.
//
// The same normalisation is mirrored in SQL in
// supabase/spend-dedupe-migration.sql to clean up rows recorded before this
// existed — keep the two in step if either changes.

// Product identity is the title, not the ASIN — which is the opposite of the
// obvious choice, and testing is why. Whether an ASIN can be recovered varies
// per email (the delivery mail for an order often has no product link at all),
// so keying on "ASIN if we have one, else the name" gives the *same* purchase
// two different keys depending on which email described it — the bug this is
// meant to fix. The catalogue title, by contrast, is the same string in every
// email about an order.
//
// Stripped to letters and digits so casing, punctuation and spacing can't
// fork it, then cut to 40 characters so a template that truncates the title
// ("Pampers Baby-Dry Size 4, 152 Nap…") still matches the untruncated one.
// The ASIN is only a fallback for the rare item with no usable title.
const NAME_KEY_CHARS = 40

export function normalizeProductName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, NAME_KEY_CHARS)
}

function productPart(item) {
  const name = normalizeProductName(item.item_name)
  if (name) return name
  return typeof item.asin === "string" ? item.asin.trim().toUpperCase() : ""
}

// Scope: the order number when the email states one — the strongest signal that
// two line items are the same purchase. Without one, the same product on the
// same day is treated as one purchase. That can in theory merge two genuinely
// separate same-day orders of the same thing, which is the right way to be wrong
// here: a total slightly under beats one inflated three-fold by dispatch and
// delivery mails.
//
// Price is deliberately *not* part of the key. It was, until a parity test
// against the SQL in supabase/spend-dedupe-migration.sql showed the two rounding
// half a cent apart — JS `(3.005).toFixed(2)` is "3.00" (binary float), Postgres
// `round(3.005, 2)` is 3.01 (exact numeric) — which would hand the same row two
// different keys and reintroduce the duplicate it exists to prevent. It only
// ever separated the same product bought twice on one day at two prices, which
// this already accepts merging.
export function spendDedupeKey(item) {
  const product = productPart(item)
  const orderId = String(item.order_id || "").trim().toLowerCase()
  if (orderId) return `o:${orderId}|${product}`
  return `d:${String(item.order_date || "")}|${product}`
}
