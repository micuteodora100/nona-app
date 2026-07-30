// Amazon order-email → structured spend line items, via real Anthropic
// tool-calling (same pattern as runCommandPrompt in lib/ai-brief.js) so the
// result is always a known shape instead of parsed prose. Cheap Haiku model
// since this is pure extraction, no judgment calls.

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
              order_id: { type: "string", description: "Amazon order number if the email states one, else an empty string." },
              items: {
                type: "array",
                description: "One entry per distinct item purchased in this order. Empty array if this email isn't an order confirmation.",
                items: {
                  type: "object",
                  properties: {
                    item_name: { type: "string", description: "Short product name/title as written in the email." },
                    price: { type: "number", description: "Price of this single item (not the order total), as a plain number with no currency symbol." },
                    currency: { type: "string", description: "3-letter currency code, e.g. EUR, GBP, USD." },
                    order_date: { type: "string", description: "Order date as ISO YYYY-MM-DD." },
                  },
                  required: ["item_name", "price", "currency", "order_date"],
                },
              },
            },
            required: ["email_id", "items"],
          },
        },
      },
      required: ["results"],
    },
  },
]

const BATCH_SIZE = 8

// Runs extraction over `emails` ({id, subject, from, date, body}), batching
// a few per call to keep each prompt small. Returns a flat array of
// {email_id, order_id, item_name, price, currency, order_date}.
export async function runAmazonExtractPrompt(client, emails) {
  const allItems = []

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    const emailsBlock = batch
      .map((e) => `--- email_id: ${e.id} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body}`)
      .join("\n\n")

    const prompt = `Here are ${batch.length} emails from Amazon. For each one, call extract_orders with one result per email_id (copy the email_id exactly as given), pulling out any purchased items. If an email isn't an order confirmation (e.g. it's a shipping/delivery update, marketing, or a recommendation email), still include its email_id with an empty items array — never skip an email_id entirely.

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
          allItems.push({ email_id: r.email_id, order_id: r.order_id || null, ...item })
        }
      }
    } catch (err) {
      console.error("Amazon extract batch failed:", err.message)
    }
  }

  return allItems
}
