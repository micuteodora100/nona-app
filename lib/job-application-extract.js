// Classifies candidate inbox emails (from a job-application keyword search,
// see fetchJobApplication*Emails in lib/email-fetch.js) by whether they're
// genuinely about a specific job application the user submitted, and what
// stage that application is at. Same real-tool-calling pattern as
// lib/spend-extract.js, cheap Haiku model since this is pure classification.
// Subject + snippet only (no full body fetch) — keeps this cheap and avoids
// an extra round of Gmail/Graph calls just to check relevance.

const CLASSIFY_TOOLS = [
  {
    name: "classify_applications",
    description: "Classify which of these emails are genuinely about a specific job application the user submitted, and their current status.",
    input_schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email_id: { type: "string", description: "The id of the email this result is for, copied exactly from the input." },
              is_job_application_related: {
                type: "boolean",
                description: "True only if this email is genuinely tied to one specific job application the user submitted — an application-received confirmation, an interview invite, a rejection, or an offer. False for job-alert digests ('new jobs matching your search'), generic newsletters, cold recruiter outreach with no application behind it, or career-site marketing — even if they mention jobs or applications.",
              },
              company: { type: "string", description: "The hiring company's name, normalized (e.g. 'Amazon', not 'Amazon.lu Recruiting Team <noreply@...>'). Empty string if not related." },
              role: { type: "string", description: "The job title applied for, if stated. Empty string if unknown." },
              status: {
                type: "string",
                enum: ["applied", "interview_invite", "rejection", "offer", "other_update"],
                description: "'applied' = application received/submitted confirmation, no further news yet. 'interview_invite' = invited to an interview or assessment. 'rejection' = declined / not moving forward. 'offer' = a job offer. 'other_update' = any other substantive update (e.g. a request for more documents).",
              },
            },
            required: ["email_id", "is_job_application_related", "company", "status"],
          },
        },
      },
      required: ["results"],
    },
  },
]

const BATCH_SIZE = 15

// `emails` is [{id, from, subject, date, snippet}]. Returns a flat array of
// {email_id, is_job_application_related, company, role, status}.
export async function runJobApplicationClassifyPrompt(client, emails) {
  const all = []

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    const block = batch
      .map((e) => `--- email_id: ${e.id} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nPreview: ${e.snippet}`)
      .join("\n\n")

    const prompt = `Here are ${batch.length} emails that matched a job-application-related keyword search. For each one, call classify_applications with one result per email_id (copy exactly), saying whether it's genuinely about a specific job application the user submitted, and if so the company, role and current status.

Be strict about is_job_application_related: job-alert newsletters, "new jobs matching your search" digests, cold recruiter outreach with no application behind it, and generic career-site marketing are all false, even though they mention jobs or applications. Only a real application confirmation, interview invite, rejection, or offer tied to one specific application counts as true.

${block}`

    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        tools: CLASSIFY_TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: prompt }],
      })
      const toolUse = message.content.find((b) => b.type === "tool_use")
      all.push(...(toolUse?.input?.results || []))
    } catch (err) {
      console.error("Job application classify batch failed:", err.message)
    }
  }

  return all
}
