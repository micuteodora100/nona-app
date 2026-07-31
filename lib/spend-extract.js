// Amazon order-email → structured spend line items, via real Anthropic
// tool-calling (same pattern as runCommandPrompt in lib/ai-brief.js) so the
// result is always a known shape instead of parsed prose. Cheap Haiku model
// since this is pure extraction, no judgment calls.

import { SPEND_CATEGORY_IDS, spendCategoryListStr } from "./spend-categories"

const EXTRACT_TOOLS = [
  {
    name: "extract_orders",
    description:
      "Extract purchased line items from a batch of Amazon emails. Only real order/order-confirmation emails contain items — shipping updates, delivery notifications, marketing, and recommendation emails have no items and should get an empty items array.",
    input_schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email_id: { type: "string", description: "The id of the email this result is for, copied exactly from the input." },
              // Amazon restates the same line items in the dispatch, delivery
              // and invoice emails for an order it already confirmed. Only
              // order_confirmation results are stored, so those restatements
              // can't each count as another purchase.
              email_kind: {
                type: "string",
                enum: ["order_confirmation", "shipping_or_delivery_update", "other"],
                description: "What this email is. 'order_confirmation' only for the email confirming a purchase was placed. Dispatch/shipped/out-for-delivery/delivered/return/refund emails are 'shipping_or_delivery_update' even when they list the items and prices. Marketing, recommendations, wish-list and account emails are 'other'.",
              },
              order_id: { type: "string", description: "Amazon order number if the email states one, else an empty string." },
              items: {
                type: "array",
                description: "One entry per distinct item purchased in this order. Empty array if this email isn't an order confirmation.",
                items: {
                  type: "object",
                  properties: {
                    item_name: { type: "string", description: "Short product name/title as written in the email." },
                    // What the thing actually is, so spend can be grouped by
                    // product type ("how much on diapers this month") rather
                    // than only ever shown as one flat Amazon total.
                    category: {
                      type: "string",
                      enum: SPEND_CATEGORY_IDS,
                      description: "The product category this item belongs to, based on what the product actually is.",
                    },
                    // Verified against the email's own markers server-side, so
                    // a made-up code just degrades to a search link.
                    asin: {
                      type: "string",
                      description: "The 10-character Amazon product code for this item, copied exactly from the [asin:XXXXXXXXXX] marker next to this product's name in the email. Empty string if this item has no such marker — never invent or guess one.",
                    },
                    price: { type: "number", description: "Price of this single item (not the order total), as a plain number with no currency symbol." },
                    currency: { type: "string", description: "3-letter currency code, e.g. EUR, GBP, USD." },
                    order_date: { type: "string", description: "Order date as ISO YYYY-MM-DD." },
                  },
                  required: ["item_name", "category", "price", "currency", "order_date"],
                },
              },
            },
            required: ["email_id", "email_kind", "items"],
          },
        },
      },
      required: ["results"],
    },
  },
]

// Smaller than the original 8 because each email body now carries more of the
// original email (product-link markers, 6000 chars instead of 3000 — see
// AMAZON_BODY_CHARS in lib/email-fetch.js), keeping per-call prompt size flat.
const BATCH_SIZE = 5

// Runs extraction over `emails` ({id, subject, from, date, body, asins}),
// batching a few per call to keep each prompt small. Returns a flat array of
// {email_id, order_id, item_name, category, asin, price, currency, order_date}.
export async function runAmazonExtractPrompt(client, emails) {
  const allItems = []

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    const emailsBlock = batch
      .map((e) => `--- email_id: ${e.id} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body}`)
      .join("\n\n")

    const prompt = `Here are ${batch.length} emails from Amazon. For each one, call extract_orders with one result per email_id (copy the email_id exactly as given), pulling out any purchased items. Always include every email_id, even when it has no items.

Set "email_kind" for each. This matters: Amazon sends several emails about the same purchase — the order confirmation, then dispatch/delivery updates, sometimes an invoice notice — and the later ones list the same items and prices again. Only the email that confirms the purchase was placed is an "order_confirmation". Anything about dispatch, shipping, delivery, returns or refunds is "shipping_or_delivery_update" even if it lists items and prices in full. Marketing, recommendations and account notices are "other". Still extract the items you can see either way; they're used to recognise the purchase, not to count it twice.

For every item, also set "category" to the single best fit from: ${spendCategoryListStr()}. Categorise by what the product actually is, not how it was marketed — e.g. "Pampers Baby-Dry size 4, 152 nappies" is diapers-wipes, "Aptamil follow-on milk 800g" is baby-food, "Arla organic whole milk 1L" is milk-dairy. Use "other" only when nothing else genuinely fits.

Some product names in the body are followed by a marker like [asin:B0CX1234YZ]. When an item has one, copy that exact code into the item's "asin" field so the product page can be linked. If an item has no marker next to it, use an empty string — never guess a code or reuse another item's.

${emailsBlock}`

    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        tools: EXTRACT_TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: prompt }],
      })

      const toolUse = message.content.find((b) => b.type === "tool_use")
      const results = toolUse?.input?.results || []
      for (const r of results) {
        for (const item of r.items || []) {
          allItems.push({
            email_id: r.email_id,
            order_id: r.order_id || null,
            // Passed through rather than filtered here so the caller can log
            // how much was dropped and why — a sudden run of everything being
            // classified "other" is worth being able to see.
            email_kind: r.email_kind || "other",
            ...item,
          })
        }
      }
    } catch (err) {
      console.error("Amazon extract batch failed:", err.message)
    }
  }

  return allItems
}

const CATEGORIZE_TOOLS = [
  {
    name: "categorize_items",
    description: "Assign a product category to each already-recorded purchase, going by its product name.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "The id of the item, copied exactly from the input." },
              category: {
                type: "string",
                enum: SPEND_CATEGORY_IDS,
                description: "The product category this item belongs to, based on what the product actually is.",
              },
            },
            required: ["id", "category"],
          },
        },
      },
      required: ["items"],
    },
  },
]

const CATEGORIZE_BATCH_SIZE = 40

// Backfill path for rows stored before categories existed (and for anything a
// sync couldn't classify): categorises from the product name alone, no email
// needed, so the breakdown covers her whole spend history the first time she
// syncs after this ships rather than only newly-arriving orders.
// `items` is [{id, item_name}]; returns a Map of id → category id.
export async function runSpendCategorizePrompt(client, items) {
  const assigned = new Map()

  for (let i = 0; i < items.length; i += CATEGORIZE_BATCH_SIZE) {
    const batch = items.slice(i, i + CATEGORIZE_BATCH_SIZE)
    const listBlock = batch.map((it) => `- id: ${it.id} | name: ${it.item_name}`).join("\n")

    const prompt = `Categorise each of these purchases by what the product actually is. Call categorize_items once with an entry for every id below, choosing from: ${spendCategoryListStr()}. Use "other" only when nothing else genuinely fits.

${listBlock}`

    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        tools: CATEGORIZE_TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: prompt }],
      })
      const toolUse = message.content.find((b) => b.type === "tool_use")
      for (const r of toolUse?.input?.items || []) {
        if (r?.id && r?.category) assigned.set(String(r.id), r.category)
      }
    } catch (err) {
      console.error("Spend categorize batch failed:", err.message)
    }
  }

  return assigned
}
