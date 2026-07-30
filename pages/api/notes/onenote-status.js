import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"

// There's no separate "connect OneNote" flow — it rides on the same
// Microsoft token as Outlook (see [...nextauth].js). This distinguishes the
// three states Settings needs to show: no Microsoft connection at all,
// connected but the stored token predates the Notes.Read scope (needs
// reconnect), or fully working. Does a live minimal Graph call rather than
// trusting a locally-cached flag, since scope isn't stored alongside the
// token in oauth_tokens.
export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.json({ ok: false, connected: false, error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "microsoft")
    if (!accessToken) {
      return res.json({ ok: true, connected: false })
    }

    // Deliberately checks /notebooks, not the bulk cross-notebook /pages
    // endpoint — /pages 400s outright once an account has more than a
    // handful of sections across its notebooks (found 29 Jul 2026 on a real
    // account with 13 sections), which used to make this status check itself
    // report a false "Graph API error" even though the scope was genuinely fine.
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me/onenote/notebooks?$top=1&$select=id",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (response.ok) {
      // Notebook list for the Settings picker — she chooses which notebooks
      // feed the AI rather than everything being read by default.
      let notebooks = []
      try {
        const notebooksResponse = await fetch(
          "https://graph.microsoft.com/v1.0/me/onenote/notebooks?$top=50&$select=id,displayName",
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        if (notebooksResponse.ok) {
          notebooks = ((await notebooksResponse.json()).value || []).map(n => ({ id: n.id, displayName: n.displayName }))
        }
      } catch (e) {
        console.error("Failed to list OneNote notebooks:", e.message)
      }
      return res.json({ ok: true, connected: true, scopeOk: true, notebooks })
    }

    if (response.status === 401 || response.status === 403) {
      return res.json({
        ok: true,
        connected: true,
        scopeOk: false,
        error: "Outlook is connected but doesn't have OneNote read access yet — reconnect Outlook to grant it.",
      })
    }

    return res.json({ ok: false, connected: true, scopeOk: false, error: `Graph API error: ${response.status}` })
  } catch (err) {
    return res.json({ ok: false, error: err.message })
  }
}
