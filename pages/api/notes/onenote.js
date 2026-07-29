import { getSupabaseUser } from "../../../lib/supabase-auth"
import { getAccessToken } from "../../../lib/tokens"

function stripHtml(html) {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Read-only OneNote via Microsoft Graph — reuses the same access token as
// Outlook (Notes.Read is requested alongside Mail.Read in the same OAuth
// consent, see [...nextauth].js), no separate connect flow or write calls.
//
// PENDING DECISION (see PR description): how many pages / how much text per
// page to pull is a judgment call with no single right answer. Went with a
// conservative cap — the 20 most recently modified pages, first 2000 chars
// of plain text each — in the same spirit as outlook.js's existing caps.
// Easy to raise once real usage shows what callers actually need.
const MAX_PAGES = 20
const MAX_CHARS_PER_PAGE = 2000

export default async function handler(req, res) {
  const user = await getSupabaseUser(req, res)
  if (!user) return res.status(401).json({ error: "Not authenticated" })

  try {
    const accessToken = await getAccessToken(user.id, "microsoft")
    if (!accessToken) {
      return res.status(401).json({ error: "Microsoft connection expired — reconnect Outlook in Settings" })
    }

    // The bulk cross-notebook `/me/onenote/pages` endpoint 400s once an
    // account has more than a handful of sections across its notebooks —
    // found 29 Jul 2026 on a real account with 13 sections in one notebook
    // ("The number of maximum sections is exceeded for this request").
    // Microsoft's own fix is what's used here: list sections, then pull pages
    // per-section instead of in one flat call.
    const sectionsResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/onenote/sections?$top=50&$select=id,displayName`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!sectionsResponse.ok) {
      // A token that was issued before Notes.Read existed (i.e. before this
      // feature shipped) simply won't carry that scope — Graph rejects it
      // with 401/403 rather than a "missing scope" message, so that's the
      // signal we surface a reconnect prompt on.
      if (sectionsResponse.status === 401 || sectionsResponse.status === 403) {
        return res.status(403).json({
          error: "Outlook is connected but doesn't have OneNote read access yet — reconnect Outlook in Settings to grant it.",
        })
      }
      const err = await sectionsResponse.text()
      throw new Error(err)
    }

    const sections = (await sectionsResponse.json()).value || []

    const perSectionResults = await Promise.allSettled(
      sections.map((s) =>
        fetch(
          `https://graph.microsoft.com/v1.0/me/onenote/sections/${s.id}/pages` +
          `?$top=${MAX_PAGES}` +
          `&$select=id,title,createdDateTime,lastModifiedDateTime,contentUrl` +
          `&$orderby=lastModifiedDateTime desc`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ).then(async (r) => {
          if (!r.ok) throw new Error(await r.text())
          return (await r.json()).value || []
        })
      )
    )

    const rawPages = []
    perSectionResults.forEach((r) => {
      if (r.status === "fulfilled") rawPages.push(...r.value)
      else console.error("OneNote section pages fetch failed:", r.reason?.message)
    })
    // Sections were each already sorted newest-first, but across sections the
    // combined list needs its own global sort before taking the overall top N.
    rawPages.sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime))
    rawPages.splice(MAX_PAGES)

    async function fetchOne(page) {
      let text = ""
      if (page.contentUrl) {
        const contentRes = await fetch(page.contentUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (contentRes.ok) {
          const html = await contentRes.text()
          text = stripHtml(html).slice(0, MAX_CHARS_PER_PAGE)
        }
      }
      return {
        id: page.id,
        title: page.title || "(untitled)",
        createdDateTime: page.createdDateTime,
        lastModifiedDateTime: page.lastModifiedDateTime,
        text,
        source: "onenote",
      }
    }

    // Same batched allSettled pattern as outlook.js — one failed page fetch
    // shouldn't take the whole notes list down.
    const BATCH_SIZE = 10
    const pages = []
    const failedIds = []
    for (let i = 0; i < rawPages.length; i += BATCH_SIZE) {
      const batch = rawPages.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(batch.map(fetchOne))
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          pages.push(r.value)
        } else {
          failedIds.push(batch[idx].id)
          console.error("OneNote page fetch failed:", batch[idx].id, r.reason?.message)
        }
      })
    }

    res.json({ pages, source: "onenote", failed: failedIds.length })
  } catch (err) {
    console.error("OneNote Graph error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
