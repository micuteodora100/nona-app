import { getServerSession } from "next-auth"
import { authOptions } from "../auth/[...nextauth]"
import { google } from "googleapis"

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions)
  if (!session || session.provider !== "google") {
    return res.status(401).json({ error: "Not authenticated with Google" })
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oauth2Client.setCredentials({ access_token: session.accessToken })

    const gmail = google.gmail({ version: "v1", auth: oauth2Client })

    // Fetch last 90 days of emails from inbox (read + unread)
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox newer_than:90d",
      maxResults: 100,
    })

    const messages = listRes.data.messages || []

    if (messages.length === 0) {
      return res.json({ emails: [], source: "gmail" })
    }

    // Fetch each message's metadata + snippet
    const emails = await Promise.all(
      messages.slice(0, 100).map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        })

        const headers = detail.data.payload.headers
        const get = (name) => headers.find((h) => h.name === name)?.value || ""

        return {
          id: msg.id,
          from: get("From"),
          subject: get("Subject"),
          date: get("Date"),
          snippet: detail.data.snippet || "",
          source: "gmail",
        }
      })
    )

    res.json({ emails, source: "gmail" })
  } catch (err) {
    console.error("Gmail error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
