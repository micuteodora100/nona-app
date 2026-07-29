import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"

// Read-only Outlook Calendar fetch via Microsoft Graph — no create/update/delete calls anywhere here.
export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "microsoft")
    if (!accessToken) {
      return res.status(401).json({ error: "Outlook connection expired — reconnect Outlook in Settings", reconnectRequired: true })
    }

    // Window: 30 days back to 60 days ahead, matches the Google Calendar route
    // so back/forward navigation in the week view doesn't refetch on every click.
    const now = new Date()
    const start = new Date(now)
    start.setDate(start.getDate() - 30)
    const end = new Date(now)
    end.setDate(end.getDate() + 60)

    const url = new URL("https://graph.microsoft.com/v1.0/me/calendarView")
    url.searchParams.set("startDateTime", start.toISOString())
    url.searchParams.set("endDateTime", end.toISOString())
    url.searchParams.set("$select", "id,subject,start,end,isAllDay,webLink")
    url.searchParams.set("$orderby", "start/dateTime")
    url.searchParams.set("$top", "250")

    const graphRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Returns start/end already localized to Luxembourg time so we can slice
        // date/time the same way the Google Calendar route does, instead of
        // hand-rolling UTC offset math.
        Prefer: 'outlook.timezone="Europe/Luxembourg"',
      },
    })

    if (!graphRes.ok) {
      // Existing Outlook connections made before Calendars.Read was added to the
      // OAuth scope carry a token that was never issued that scope — Graph
      // rejects the calendar call with 401/403 rather than an empty result.
      // Surface that as a clear reconnect message instead of a generic 500.
      if (graphRes.status === 401 || graphRes.status === 403) {
        return res.status(403).json({
          error: "Outlook Calendar isn't connected yet — reconnect Outlook in Settings to see your calendar",
          reconnectRequired: true,
        })
      }
      const text = await graphRes.text()
      throw new Error(`Graph calendar fetch failed: ${graphRes.status} ${text}`)
    }

    const data = await graphRes.json()
    const events = (data.value || [])
      .map((e) => {
        const startDate = e.start?.dateTime?.slice(0, 10)
        if (!startDate) return null
        return {
          id: e.id,
          text: e.subject || "(no title)",
          date: startDate,
          time: e.isAllDay ? null : e.start?.dateTime?.slice(11, 16) || null,
          link: e.webLink || null,
        }
      })
      .filter(Boolean)

    res.json({ events, source: "outlook-calendar" })
  } catch (err) {
    console.error("Outlook Calendar error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
