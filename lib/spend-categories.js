// Product-level spend categories — what a thing *is* (milk, diapers, nappy
// cream), not which shop it came from. Used both server-side (the AI extraction
// in lib/spend-extract.js picks one of these ids per line item) and client-side
// (pages/app.js renders the breakdown), so this file stays dependency-free.
//
// Ids are stable and stored in spend_items.category; only `label`/`emoji` are
// user-facing, same split as the task categories in lib/categories.js.
export const SPEND_CATEGORIES = [
  { id: "milk-dairy", label: "Milk & dairy", emoji: "🥛" },
  { id: "diapers-wipes", label: "Diapers & wipes", emoji: "🧷" },
  { id: "baby-food", label: "Baby food & formula", emoji: "🍼" },
  { id: "baby-gear", label: "Baby gear", emoji: "👶" },
  { id: "groceries", label: "Groceries & pantry", emoji: "🛒" },
  { id: "household", label: "Household & cleaning", emoji: "🧽" },
  { id: "health", label: "Health & pharmacy", emoji: "💊" },
  { id: "beauty", label: "Beauty & personal care", emoji: "🧴" },
  { id: "clothing", label: "Clothing & shoes", emoji: "👕" },
  { id: "toys-books", label: "Toys & books", emoji: "🧸" },
  { id: "electronics", label: "Electronics & tech", emoji: "🔌" },
  { id: "home", label: "Home & kitchen", emoji: "🏠" },
  { id: "pet", label: "Pet", emoji: "🐾" },
  { id: "other", label: "Other", emoji: "📦" },
]

// Rows synced before categories existed (and anything the AI failed to
// classify) carry category = null — they group under this pseudo-category
// rather than being hidden from the breakdown.
export const UNCATEGORIZED = { id: null, label: "Uncategorised", emoji: "❔" }

// Fed to the extraction/classification prompts so the model only ever sees
// the ids it's allowed to return.
export const SPEND_CATEGORY_IDS = SPEND_CATEGORIES.map((c) => c.id)

export function spendCategoryListStr() {
  return SPEND_CATEGORIES.map((c) => `${c.id} (${c.label})`).join(", ")
}

// Clamps a model-returned category to the list it was actually offered —
// same defensive pattern as validTag() in lib/categories.js. Returns null
// (uncategorised) rather than guessing when the value isn't a known id.
export function validSpendCategory(id) {
  if (!id) return null
  return SPEND_CATEGORY_IDS.includes(id) ? id : null
}

export function spendCategoryMeta(id) {
  return SPEND_CATEGORIES.find((c) => c.id === id) || UNCATEGORIZED
}

// ── Amazon product links ──────────────────────────────────────────────────
// Every Amazon product page is reachable at /dp/<ASIN>, so an ASIN plus the
// marketplace domain is all that's needed to link straight to the product —
// far more robust than storing the giant click-tracking redirect URLs that
// actually appear in order emails (they expire and can't be verified).
const ASIN_RE = /\b(B0[A-Z0-9]{8}|\d{9}[\dX])\b/

export function isAsin(value) {
  return typeof value === "string" && ASIN_RE.test(value.trim().toUpperCase()) && value.trim().length === 10
}

// Marketplace Nona defaults to when nothing better is known. Luxembourg
// shops on amazon.de in practice (the weather widget is hardcoded to
// Luxembourg too), so that beats a .com guess here.
export const DEFAULT_AMAZON_DOMAIN = "www.amazon.de"

export function amazonProductUrl(asin, domain) {
  if (!isAsin(asin)) return null
  return `https://${domain || DEFAULT_AMAZON_DOMAIN}/dp/${asin.trim().toUpperCase()}`
}

// Fallback for items whose ASIN couldn't be recovered from the email (older
// syncs, plain-text emails with no product links): a search for the item name
// still lands her on the product in one tap, which is the whole point.
export function amazonSearchUrl(itemName, domain) {
  return `https://${domain || DEFAULT_AMAZON_DOMAIN}/s?k=${encodeURIComponent(itemName || "")}`
}

// Direct product link when we have one, search as the graceful fallback.
export function spendItemUrl(item, domain) {
  return item?.product_url || amazonSearchUrl(item?.item_name, domain)
}
