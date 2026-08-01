// Amazon order-email → structured spend line items, via real Anthropic
// tool-calling (same pattern as runCommandPrompt in lib/ai-brief.js) so the
// result is always a known shape instead of parsed prose. Cheap Haiku model
// since this is pure extraction, no judgment calls.

// Fixed category list. Deliberately closed rather than free-text: the widget
// groups by these, and a model inventing "Fan"/"Cooling"/"Home appliance" for
// three near-identical purchases makes the breakdown useless. Everything used
// to land as uncategorized because there was no category field at all.
export const SPEND_CATEGORIES = [
  "Home & garden",
  "Kitchen",
  "Electronics",
  "Kids & baby",
  "Clothing & shoes",
  "Health & beauty",
  "Groceries & household",
  "Pet",
  "Books & media",
  "Hobby & sport",
  "Office & stationery",
  "Other",
]

const EXTRACT_TOOLS = [
  {
    name: "extract_orders",
    description:
      "Classify a batch of Amazon emails and extract purchased or refunded line items from them. Most Amazon emails are NOT order confirmations — shipping, dispatch and delivery notifications repeat the product name and price of an order that was already confirmed elsewhere, and must be classified as shipping_update with no items, or the same purchase gets counted twice.",
    input_schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email_id: { type: "string", description: "The id of the email this result is for, copied exactly from the input." },
              // Asked for explicitly, and first, rather than left implicit in
              // the instructions. The old prompt just said "shipping updates
              // have no items" in prose and the model routinely ignored it,
              // extracting the product out of every dispatch and delivery
              // notification — which is how one fan bought once became three
              // rows.
              email_type: {
                type: "string",
                enum: ["order_confirmation", "shipping_update", "refund_or_return", "marketing", "other"],
                description:
                  "order_confirmation: states an order has been placed, with items and prices. shipping_update: dispatch/shipped/out for delivery/delivered notification for an order already placed. refund_or_return: a refund has been issued, a return received, or an order cancelled. marketing: recommendations, deals, wish list. other: anything else.",
              },
              order_id: { type: "string", description: "Amazon order number if the email states one, else an empty string. Include it even for shipping updates and refunds — it is what links them back to the original order." },
              items: {
                type: "array",
                description:
                  "Line items. Populate ONLY when email_type is order_confirmation (things bought) or refund_or_return (things refunded/returned). Must be an empty array for shipping_update, marketing and other.",
                items: {
                  type: "object",
                  properties: {
                    item_name: { type: "string", description: "Short product name/title as written in the email." },
                    price: { type: "number", description: "Price of this single item (not the order total), as a plain number with no currency symbol. For a refund, the amount refunded, as a positive number." },
                    currency: { type: "string", description: "3-letter currency code, e.g. EUR, GBP, USD." },
                    order_date: { type: "string", description: "Order date as ISO YYYY-MM-DD. For a refund, the date of the refund." },
                    category: {
                      type: "string",
                      enum: SPEND_CATEGORIES,
                      description: "What kind of product this is, judged from the product name. Use \"Other\" only when the name genuinely doesn't indicate a type.",
                    },
                  },
                  required: ["item_name", "price", "currency", "order_date", "category"],
                },
              },
            },
            required: ["email_id", "email_type", "items"],
          },
        },
      },
      required: ["results"],
    },
  },
]

const BATCH_SIZE = 8

// Which email types actually produce rows, and what those rows mean.
const KIND_BY_TYPE = {
  order_confirmation: "purchase",
  refund_or_return: "refund",
}

// Normalized so the same product written slightly differently across an order
// confirmation and its refund email still lines up.
export function normalizeItemName(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)
}

// The key two rows must share to be considered the same purchase. Order number
// first, because that is what makes this work: the dispatch and delivery
// emails for an order carry the same order number as the confirmation, and so
// does the copy that landed in a second connected mailbox. Keying on the
// email's own id (as this used to) gave every one of those a different key,
// which is why a single purchase showed up repeatedly.
export function dedupeKeyFor({ orderId, emailId, itemName }) {
  const item = normalizeItemName(itemName)
  return orderId ? `o:${orderId}::${item}` : `e:${emailId}::${item}`
}

// Runs extraction over `emails` ({id, subject, from, date, body}), batching
// a few per call to keep each prompt small. Returns a flat array of
// {email_id, order_id, kind, item_name, price, currency, order_date, category,
// dedupe_key}.
export async function runAmazonExtractPrompt(client, emails) {
  const allItems = []

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    const emailsBlock = batch
      .map((e) => `--- email_id: ${e.id} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body}`)
      .join("\n\n")

    const prompt = `Here are ${batch.length} emails from Amazon. Call extract_orders with exactly one result per email_id (copy each email_id exactly as given, never skip one).

For each email, first decide its email_type, then extract items only if that type calls for it:
- Only an email that announces a NEW order being placed is an order_confirmation.
- An email saying an order has shipped, been dispatched, is out for delivery, or has been delivered is a shipping_update — it names the same products as the original confirmation, and extracting them would double-count a purchase that already exists. Give it an empty items array.
- An email about a refund being issued, a return being received, or an order being cancelled is refund_or_return. Extract the affected items with the amount refunded, so the spend total can be corrected.
- Always fill in order_id when the email shows an order number, whatever the type.

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
        const kind = KIND_BY_TYPE[r.email_type]
        // Anything that isn't an order or a refund contributes no rows, even
        // if the model went ahead and filled in items anyway.
        if (!kind) continue
        const orderId = r.order_id || null
        for (const item of r.items || []) {
          if (!item?.item_name || !Number.isFinite(item.price)) continue
          allItems.push({
            email_id: r.email_id,
            order_id: orderId,
            kind,
            item_name: item.item_name,
            price: Math.abs(item.price),
            currency: item.currency,
            order_date: item.order_date,
            category: SPEND_CATEGORIES.includes(item.category) ? item.category : "Other",
            dedupe_key: dedupeKeyFor({ orderId, emailId: r.email_id, itemName: item.item_name }),
          })
        }
      }
    } catch (err) {
      console.error("Amazon extract batch failed:", err.message)
    }
  }

  // Same order can appear in more than one email inside a single run (and the
  // same email can arrive in both connected mailboxes), so collapse before the
  // rows ever reach the database rather than relying only on the constraint.
  const byKey = new Map()
  for (const item of allItems) {
    const key = `${item.kind}::${item.dedupe_key}`
    if (!byKey.has(key)) byKey.set(key, item)
  }
  return [...byKey.values()]
}
