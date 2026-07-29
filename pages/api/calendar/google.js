import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"
import { google } from "googleapis"

// Read-only Google Calendar fetch — no create/update/delete calls anywhere here.
export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "google")
    if (!accessToken) {
      return res.status(401).json({ error: "Google connection expired — reconnect Google in Settings", reconnectRequired: true })
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    oauth2Client.setCredentials({ access_token: accessToken })

    const calendar = google.calendar({ version: "v3", auth: oauth2Client })

    // Window: 30 days back to 60 days ahead, covers a few weeks of back/forward
    // navigation in the week view without refetching on every click.
    const now = new Date()
    const timeMin = new Date(now)
    timeMin.setDate(timeMin.getDate() - 30)
    const timeMax = new Date(now)
    timeMax.setDate(timeMax.getDate() + 60)

    let listRes
    try {
      listRes = await calendar.events.list({
        calendarId: "primary",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
      })
    } catch (err) {
      // Existing Google connections made before calendar.readonly was added to the
      // OAuth scope carry a token that was never issued that scope — Google rejects
      // the calendar call with 401/403 rather than an empty result. Surface that as
      // a clear reconnect message instead of a generic 500.
      const status = err.code || err.response?.status
      if (status === 401 || status === 403) {
        return res.status(403).json({
          error: "Google Calendar isn't connected yet — reconnect Google in Settings to see your calendar",
          reconnectRequired: true,
        })
      }
      throw err
    }

    const events = (listRes.data.items || [])
      .filter((e) => e.status !== "cancelled")
      .map((e) => {
        const startDate = e.start?.date || e.start?.dateTime?.slice(0, 10)
        if (!startDate) return null
        return {
          id: e.id,
          text: e.summary || "(no title)",
          date: startDate,
          time: e.start?.dateTime ? e.start.dateTime.slice(11, 16) : null,
          link: e.htmlLink || null,
        }
      })
      .filter(Boolean)

    res.json({ events, source: "google-calendar" })
  } catch (err) {
    console.error("Google Calendar error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
