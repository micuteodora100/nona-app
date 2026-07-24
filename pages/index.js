import { useState, useEffect, useCallback } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import Head from "next/head"
import { supabase } from "../lib/supabase"
import { subscribeToPush, unsubscribeFromPush, getPushPermissionState } from "../lib/push-client"
import { getCategories, categoryLabel, slugifyCategoryId } from "../lib/categories"

// ── helpers ──────────────────────────────────────────────────────────────
const STORAGE_KEY = "nona_v2"

function loadState() {
  if (typeof window === "undefined") return null
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null }
}

function saveState(s) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// Cache helpers — store AI results with timestamp, expire after maxHours
function saveCache(key, value) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(key, JSON.stringify({ value, ts: Date.now() })) } catch {}
}

function loadCache(key, maxHours) {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { value, ts } = JSON.parse(raw)
    if (Date.now() - ts > maxHours * 60 * 60 * 1000) return null
    return value
  } catch { return null }
}

// Supabase sync — save to server (cross-device persistence)
async function syncToSupabase(tasks, profile, handledEmails) {
  try {
    await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks, profile, handledEmails: [...handledEmails] }),
    })
  } catch (e) {
    // Sync failure is non-fatal — localStorage is the fallback
    console.warn('Supabase sync failed:', e.message)
  }
}

// Load from Supabase — returns null if unavailable
async function loadFromSupabase() {
  try {
    const r = await fetch('/api/sync')
    if (!r.ok) return null
    const { data } = await r.json()
    return data
  } catch { return null }
}

function guessTag(text) {
  const t = text.toLowerCase()
  if (/crèche|creche|timothée|timothee|school|swim|gym|pick.up|drop.off/.test(t)) return "family"
  if (/dentist|doctor|pharmacie|appointment/.test(t)) return "health"
  if (/job|apply|application|cv|interview|linkedin|recruiter/.test(t)) return "applications"
  if (/invoice|bill|payment|refund|subscription/.test(t)) return "bills"
  if (/buy|groceries|lidl|shop|errand/.test(t)) return "groceries"
  return null
}

function weatherIcon(code) {
  if (code === 0) return "☀️"
  if (code <= 2) return "⛅"
  if (code <= 3) return "☁️"
  if (code <= 48) return "🌫"
  if (code <= 67) return "🌧"
  if (code <= 77) return "🌨"
  if (code <= 99) return "⛈"
  return "🌤"
}

// Task/calendar dates are plain "YYYY-MM-DD" strings with no time-of-day meaning.
// new Date("YYYY-MM-DD") parses that as UTC midnight (per spec), and
// date.toISOString() always emits UTC — round-tripping either one through the
// local timezone shifts the displayed/compared day by one for anyone not
// exactly on UTC (e.g. Luxembourg's UTC+1/+2 shifts it backward a day, tapping
// "Sat 25" and having it save/label as "Fri 24"). These two helpers stay in
// local time throughout so a calendar day always means the day that was shown.
function parseLocalDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const WEEKS_AHEAD_RECURRING = 8

// Turns a recurring template ({id, text, days: [0-6], tag}) into real dated
// tasks tagged with recurringId, same as any other task everywhere else
// (calendar, brief, Tasks tab) — no special-casing needed at render time.
// Only ever extends FORWARD from whatever's already been generated for a
// given series; it never backfills a date, so deleting one occurrence (e.g.
// skipping football one Saturday) doesn't get silently regenerated next time
// this runs — it just stops covering that date going forward from the gap.
function materializeRecurring(currentTasks, recurring) {
  if (!recurring?.length) return currentTasks
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(today.getDate() + WEEKS_AHEAD_RECURRING * 7)

  const newOnes = []
  for (const r of recurring) {
    if (!r.days?.length) continue
    const existingDates = currentTasks.filter(t => t.recurringId === r.id).map(t => t.date).sort()
    const latest = existingDates.length ? parseLocalDate(existingDates[existingDates.length - 1]) : new Date(today.getTime() - 86400000)
    const start = new Date(Math.max(today.getTime(), latest.getTime() + 86400000))
    for (let d = new Date(start); d <= horizon; d.setDate(d.getDate() + 1)) {
      if (r.days.includes(d.getDay())) {
        newOnes.push({
          id: `${r.id}-${toISODate(d)}`,
          text: r.text, date: toISODate(d), done: false,
          tag: r.tag || guessTag(r.text) || "family",
          recurringId: r.id,
        })
      }
    }
  }
  return newOnes.length ? [...newOnes, ...currentTasks] : currentTasks
}

function weatherLabel(code) {
  if (code === 0) return "Clear"
  if (code <= 2) return "Partly cloudy"
  if (code <= 3) return "Cloudy"
  if (code <= 48) return "Foggy"
  if (code <= 67) return "Rainy"
  if (code <= 77) return "Snowy"
  if (code <= 99) return "Stormy"
  return ""
}

// ── component ─────────────────────────────────────────────────────────────
export default function Nona() {
  const { data: session } = useSession()

  const [onboarded, setOnboarded] = useState(false)
  const [supabaseUser, setSupabaseUser] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)

  // Listen for Supabase auth state changes
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSupabaseUser(session?.user || null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseUser(session?.user || null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    getPushPermissionState().then((state) => setPushEnabled(state === "granted"))
  }, [])

  async function handleTogglePush() {
    setPushBusy(true)
    try {
      if (pushEnabled) {
        await unsubscribeFromPush()
        setPushEnabled(false)
      } else {
        await subscribeToPush()
        setPushEnabled(true)
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setPushBusy(false)
    }
  }

  const [disconnectingProvider, setDisconnectingProvider] = useState(null)

  // Disconnects only the given provider (Gmail or Outlook), leaving the other
  // one signed in — signOut() would clear both, which is what "Disconnect all"
  // is for instead.
  async function disconnectProvider(provider) {
    setDisconnectingProvider(provider)
    try {
      const r = await fetch("/api/auth/disconnect-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error || "Failed to disconnect")
      }
      window.location.reload()
    } catch (err) {
      alert(err.message)
      setDisconnectingProvider(null)
    }
  }
  const [obStep, setObStep] = useState(1)
  const [obName, setObName] = useState("")
  const [obChild, setObChild] = useState("")
  const [obTime, setObTime] = useState("07:00")
  const [obLoad, setObLoad] = useState("")
  const [obCreche, setObCreche] = useState("")
  const [obWork, setObWork] = useState("")

  const [profile, setProfile] = useState({ name: "", child: "", briefTime: "07:00", work: "", creche: "", language: "en-GB", emailFilters: [], recurring: [] })
  const [tasks, setTasks] = useState([])
  const [tab, setTab] = useState("home") // home | tasks | mail | settings
  const [weekOffset, setWeekOffset] = useState(0) // weeks from current week

  const [weather, setWeather] = useState(null)
  const [brief, setBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)

  const [emails, setEmails] = useState([])
  const [triage, setTriage] = useState(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState(null)
  const [showAllEmails, setShowAllEmails] = useState(false)
  const [addedTaskIndices, setAddedTaskIndices] = useState([])
  const [handledEmails, setHandledEmails] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("nona_handled_emails") || "[]")) }
    catch { return new Set() }
  })
  const [outlookStatus, setOutlookStatus] = useState(null) // null=unchecked, {ok, error/email}

  const [taskInput, setTaskInput] = useState("")
  const [taskFilter, setTaskFilter] = useState("all")

  // ── boot ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = loadState()
    if (s?.onboarded) {
      setOnboarded(true)
      setProfile(s.profile || {})
      setTasks(materializeRecurring(s.tasks || [], s.profile?.recurring))
    }
  }, [])

  // Save to localStorage on every change
  useEffect(() => {
    if (onboarded) {
      saveState({ onboarded: true, profile, tasks })
    }
  }, [onboarded, profile, tasks])

  // Sync to Supabase when session is available and data changes
  useEffect(() => {
    if (onboarded && session) {
      const timer = setTimeout(() => {
        syncToSupabase(tasks, profile, handledEmails)
      }, 2000) // debounce 2s to avoid hammering on rapid changes
      return () => clearTimeout(timer)
    }
  }, [tasks, profile, onboarded, session])

  // Load from Supabase when session first becomes available (cross-device sync)
  useEffect(() => {
    if (session && onboarded) {
      loadFromSupabase().then(data => {
        if (data) {
          // Supabase data takes precedence over localStorage for cross-device sync
          if (data.tasks?.length > 0) setTasks(data.tasks)
          if (data.profile?.name) setProfile(data.profile)
          if (data.handled_emails?.length > 0) {
            setHandledEmails(new Set(data.handled_emails))
            try { localStorage.setItem("nona_handled_emails", JSON.stringify(data.handled_emails)) } catch {}
          }
        }
      })
    }
  }, [session])

  useEffect(() => {
    if (onboarded) {
      fetchWeather()
      checkOutlookStatus()
      // Only regenerate brief if older than 6 hours
      const cachedBrief = loadCache("nona_brief", 6)
      if (cachedBrief) {
        setBrief(cachedBrief)
        setBriefLoading(false)
      } else {
        generateBrief()
      }
      // Triage loads on demand (Mail tab) — not on boot
    }
  }, [onboarded])

  // ── onboarding ───────────────────────────────────────────────────────
  const [obParsing, setObParsing] = useState(false)

  async function obNext() {
    if (obStep === 1) {
      setObStep(2)
    } else if (obStep === 2) {
      if (obLoad.trim()) {
        setObParsing(true)
        const parsed = await parseTasksFromText(obLoad)
        setTasks(parsed)
        setObParsing(false)
      }
      setObStep(3)
    } else {
      const p = { name: obName || "Teodora", child: obChild || "Timothée, 3", briefTime: obTime, work: obWork, creche: obCreche }
      setProfile(p)
      setOnboarded(true)
    }
  }

  // ── weather ──────────────────────────────────────────────────────────
  async function fetchWeather() {
    try {
      const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=49.6116&longitude=6.1319&current=temperature_2m,weathercode&timezone=Europe/Luxembourg")
      const d = await r.json()
      setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weathercode })
    } catch { setWeather({ temp: null, code: 0 }) }
  }

  // ── outlook status ───────────────────────────────────────────────────
  async function checkOutlookStatus() {
    try {
      const r = await fetch("/api/email/outlook-status")
      const d = await r.json()
      setOutlookStatus(d)
    } catch (e) {
      setOutlookStatus({ ok: false, error: e.message })
    }
  }

  // ── emails ───────────────────────────────────────────────────────────
  async function fetchEmails(force = false) {
    // Load from cache if fresh (3 hours) and not forced
    if (!force) {
      const cached = loadCache("nona_triage", 3)
      if (cached && cached.triage && cached.emails) {
        setEmails(cached.emails)
        setTriage(cached.triage)
        setEmailLoading(false)
        return
      }
    }
    setEmailLoading(true)
    setEmailError(null)
    try {
      const allEmails = []
      const fetchErrors = []
      // Gmail via OAuth
      if (session?.providers?.google) {
        const r = await fetch("/api/email/gmail")
        if (r.ok) {
          const d = await r.json()
          allEmails.push(...(d.emails || []))
        } else {
          const errText = await r.text().catch(() => r.statusText)
          fetchErrors.push(`Gmail: ${errText.slice(0, 200)}`)
          console.error("Gmail fetch failed:", r.status, errText)
        }
      }
      // Outlook via Microsoft Graph OAuth (proper OAuth, replaces IMAP)
      if (session?.providers?.microsoft) {
        const ro = await fetch("/api/email/outlook")
        if (ro.ok) {
          const d = await ro.json()
          allEmails.push(...(d.emails || []))
        } else {
          const errText = await ro.text().catch(() => ro.statusText)
          fetchErrors.push(`Outlook: ${errText.slice(0, 200)}`)
          console.error("Outlook fetch failed:", ro.status, errText)
        }
      }
      if (allEmails.length === 0 && !session) {
        setEmailError("Connect Gmail or Outlook to see your emails.")
        setEmailLoading(false)
        return
      }
      if (allEmails.length === 0 && fetchErrors.length > 0) {
        // Previously this failed silently — no emails, no error, no triage, and
        // no indication anything had gone wrong. Now it's surfaced explicitly.
        setEmailError(`Couldn't load email: ${fetchErrors.join(" · ")}`)
        setEmailLoading(false)
        return
      }
      // Sort newest first so the AI sees the most relevant emails
      allEmails.sort((a, b) => {
        const da = new Date(a.date).getTime() || 0
        const db = new Date(b.date).getTime() || 0
        return db - da
      })
      setEmails(allEmails)
      if (allEmails.length > 0) await triageEmails(allEmails)
    } catch (e) {
      setEmailError(e.message)
    }
    setEmailLoading(false)
  }

  async function triageEmails(emailList) {
    // Filter out emails already handled (task was completed) before sending to AI
    // Also apply global filter rules defined by user in Settings
    const globalFilters = profile.emailFilters || []
    const filteredList = emailList.filter(e => {
      const key = `${e.from}::${e.subject}`
      if (handledEmails.has(key)) return false
      // Check global filter rules (pattern matching on sender or subject)
      for (const rule of globalFilters) {
        const r = rule.toLowerCase()
        if (e.from?.toLowerCase().includes(r) || e.subject?.toLowerCase().includes(r)) return false
      }
      return true
    })
    const listToTriage = filteredList.length > 0 ? filteredList : emailList
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "triage",
          emails: listToTriage,
          context: { name: profile.name || "Teodora", child: profile.child || "Timothée" },
          categories: getCategories(profile),
        }),
      })
      const text = await r.text()
      let d
      try {
        d = JSON.parse(text)
      } catch(e) {
        // The HTTP response body itself wasn't even valid JSON — genuine network/server failure
        d = { urgent: [], action: [], tasks: [], summary: null, error: `Triage failed: server returned an unreadable response (${text.slice(0, 150)})` }
      }
      // If the AI endpoint itself reported a failure (e.g. Claude's output didn't parse as JSON),
      // that used to get silently treated as "0 urgent, 0 action" with a fake-looking summary.
      // Surface it as a real error instead — a blank inbox and a broken triage call must never look the same.
      if (!r.ok || d.error) {
        d = { urgent: [], action: [], tasks: [], summary: null, error: d.error || `Triage failed (HTTP ${r.status})` }
      }
      // Ensure all expected fields exist
      d.urgent = d.urgent || []
      d.action = d.action || []
      d.tasks = d.tasks || []
      d.summary = d.summary || (d.error ? null : `${emailList.length} emails loaded.`)
      setTriage(d)
      if (!d.error) saveCache("nona_triage", { triage: d, emails: emailList })
      // Auto-add extracted tasks — each carries its own AI-guessed category
      // (defensive `typeof` check in case an older cached response or a raw-JSON
      // fallback ever hands back plain strings instead of {text, tag} objects)
      if (d.tasks?.length) {
        const newTasks = d.tasks.map(item => {
          const text = typeof item === "string" ? item : item.text
          const tag = typeof item === "string" ? null : (item.tag || null)
          return { id: String(Date.now() + Math.random()), text, done: false, tag, fromEmail: true }
        })
        setTasks(prev => [...newTasks, ...prev])
      }
      // Auto-add calendar events extracted from emails
      if (d.calendar_events?.length) {
        const newEvents = d.calendar_events
          .filter(e => e.date && e.text)
          .map(e => ({
            id: String(Date.now() + Math.random()),
            text: e.text,
            date: e.date,
            done: false,
            tag: "family",
            fromEmail: true,
            isEvent: true, // scheduled event, not an action item — must not show in Tasks lists (locked decision)
          }))
        setTasks(prev => {
          // Only add if not already in tasks (dedup by text+date)
          const existing = new Set(prev.map(t => `${t.text}::${t.date}`))
          const fresh = newEvents.filter(e => !existing.has(`${e.text}::${e.date}`))
          return [...fresh, ...prev]
        })
      }
    } catch(e) {
      setTriage({ urgent: [], action: [], tasks: [], summary: "Could not triage emails: " + e.message })
    }
  }

  function dismissEmail(email) {
    const key = `${email.from}::${email.subject}`
    // Add to handled list so it never appears in triage or tasks again
    setHandledEmails(prev => {
      const next = new Set(prev)
      next.add(key)
      try { localStorage.setItem("nona_handled_emails", JSON.stringify([...next])) } catch {}
      return next
    })
    // Remove from triage display immediately
    setTriage(prev => {
      if (!prev) return prev
      const filterOut = (arr) => arr?.filter(item => {
        const e = emails[item.index - 1]
        return e ? `${e.from}::${e.subject}` !== key : true
      })
      return { ...prev, urgent: filterOut(prev.urgent), action: filterOut(prev.action) }
    })
    // Also mark any tasks from this email as done
    setTasks(prev => prev.map(t => t.emailKey === key ? { ...t, done: true } : t))
  }

  async function addEmailAsTask(email, index) {
    const dupeKey = `${email.from}::${email.subject}`
    // Skip if already handled (task was previously completed) or already exists in current session
    if (handledEmails.has(dupeKey) || tasks.some(t => t.emailKey === dupeKey)) {
      setAddedTaskIndices(prev => [...prev, index])
      return
    }

    setAddedTaskIndices(prev => [...prev, index])
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email_to_task",
          email: { from: email.from, subject: email.subject, snippet: email.snippet || "" },
          categories: getCategories(profile),
        }),
      })
      const d = await r.json()
      const task = {
        id: String(Date.now() + Math.random()),
        text: d.text || email.subject,
        description: d.description || email.snippet || "",
        date: d.date || null,
        done: false,
        tag: d.tag || null,
        fromEmail: true,
        emailKey: dupeKey,
      }
      setTasks(prev => [task, ...prev])
    } catch (e) {
      // fallback: still add something rather than fail silently
      setTasks(prev => [{
        id: String(Date.now() + Math.random()), text: email.subject, description: email.snippet || "", date: null, done: false, tag: null, fromEmail: true, emailKey: dupeKey,
      }, ...prev])
    }
  }

  // ── brief ─────────────────────────────────────────────────────────────
  async function generateBrief() {
    setBriefLoading(true)
    setBrief(null)
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "brief",
          tasks,
          context: {
            name: profile.name || "Teodora",
            child: profile.child || "Timothée",
            creche: profile.creche,
            work: profile.work,
            emailSummary: triage?.summary || null,
          },
        }),
      })
      const d = await r.json()
      setBrief(d.text)
      saveCache("nona_brief", d.text)
    } catch { setBrief("Couldn't load your brief. Check your connection.") }
    setBriefLoading(false)
  }

  // ── tasks ─────────────────────────────────────────────────────────────
  const [taskAdding, setTaskAdding] = useState(false)
  const [voiceRecording, setVoiceRecording] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState("") // shared draft text — filled by typing or by speech recognition
  const [voiceStatus, setVoiceStatus] = useState("") // "listening" | "thinking" | "" | an error message to show as placeholder
  const recognitionRef = { current: null }
  const [taskGroupBy, setTaskGroupBy] = useState("date") // date | tag | none
  const [editingTaskId, setEditingTaskId] = useState(null)
  const [addingForDate, setAddingForDate] = useState(null) // ISO date of the calendar day currently showing its quick-add row
  const [dateTaskInput, setDateTaskInput] = useState("")
  const [newRecurringText, setNewRecurringText] = useState("")
  const [newRecurringDays, setNewRecurringDays] = useState([])

  function addRecurring() {
    const text = newRecurringText.trim()
    if (!text || newRecurringDays.length === 0) return
    const r = { id: String(Date.now() + Math.random()), text, days: [...newRecurringDays].sort(), tag: guessTag(text) || "family" }
    const nextRecurring = [...(profile.recurring || []), r]
    setProfile(p => ({ ...p, recurring: nextRecurring }))
    setTasks(prev => materializeRecurring(prev, nextRecurring))
    setNewRecurringText("")
    setNewRecurringDays([])
  }

  function removeRecurring(id) {
    // Only stops future occurrences — doesn't retroactively delete instances
    // already generated, since those are just normal tasks by this point and
    // may already be checked off or otherwise acted on.
    setProfile(p => ({ ...p, recurring: (p.recurring || []).filter(r => r.id !== id) }))
  }

  async function parseTasksFromText(text) {
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "parse_tasks", text, categories: getCategories(profile) }),
      })
      const d = await r.json()
      if (d.tasks && Array.isArray(d.tasks)) {
        return d.tasks.map(t => ({
          id: String(Date.now() + Math.random()),
          text: t.text,
          date: t.date || null,
          done: false,
          tag: t.tag || guessTag(t.text),
        }))
      }
    } catch (e) {}
    // fallback: naive split if AI parsing fails
    return text.split(/[,\n]+/).map(s => s.trim()).filter(s => s.length > 2)
      .map(t => ({ id: String(Date.now() + Math.random()), text: t, date: null, done: false, tag: guessTag(t) }))
  }

  function formatDateShort(isoDate) {
    try {
      return parseLocalDate(isoDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    } catch { return isoDate }
  }

  // ── avatar — either an uploaded photo or a colored-initial fallback,
  // stored inline in `profile` (already synced to Supabase as JSON) so it
  // doesn't need any new storage infra ──────────────────────────────────
  const AVATAR_COLORS = ["#FF6B4A", "#8B7FD1", "#4FA37C", "#4A9FD8", "#E0709B", "#D9A441"]

  function renderAvatar(size) {
    if (profile.avatarUrl) {
      return <img src={profile.avatarUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)", flexShrink: 0 }} />
    }
    const initial = (profile.name || "N").trim().charAt(0).toUpperCase()
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: profile.avatarColor || "var(--gold)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#FFFFFF", fontSize: Math.round(size * 0.42), fontWeight: 600,
      }}>{initial}</div>
    )
  }

  function handleAvatarFile(e) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file later
    if (!file || !file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        // Resize/crop to a small square so the data URI stays cheap to store
        // inline in the profile JSON (no Supabase Storage bucket needed).
        const size = 200
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale, h = img.height * scale
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        setProfile(p => ({ ...p, avatarUrl: canvas.toDataURL("image/jpeg", 0.85) }))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  function getWeekDays(offset) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const day = today.getDay() // 0=Sun
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(today)
    monday.setDate(today.getDate() + mondayOffset + offset * 7)

    const days = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const iso = toISODate(d)
      const isToday = iso === toISODate(today)
      const dayTasks = tasks.filter(t => t.date === iso && !t.done)
      days.push({ date: d, iso, isToday, label: d.toLocaleDateString("en-GB", { weekday: "short" })[0], num: d.getDate(), tasks: dayTasks })
    }
    return days
  }

  function getWeekLabel(offset) {
    const days = getWeekDays(offset)
    const first = days[0].date, last = days[6].date
    if (first.getMonth() === last.getMonth()) {
      return first.toLocaleDateString("en-GB", { month: "long" })
    }
    return `${first.toLocaleDateString("en-GB", { month: "short" })} – ${last.toLocaleDateString("en-GB", { month: "short" })}`
  }

  function startVoiceCapture() {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setVoiceStatus("Voice not supported — try Chrome on Android")
      setTimeout(() => setVoiceStatus(""), 3000)
      return
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SR()
    recognition.lang = profile.language || "en-GB"
    recognition.continuous = true
    recognition.interimResults = true
    recognitionRef.current = recognition

    setVoiceRecording(true)
    setVoiceStatus("listening")
    setVoiceTranscript("")

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join("")
      setVoiceTranscript(transcript)
    }

    // Recording stops but the transcript stays in the box, still editable —
    // same field the user could've typed into, so it needs an explicit tap
    // on the send button (or Enter) to actually add the tasks.
    recognition.onend = () => {
      setVoiceRecording(false)
      recognitionRef.current = null
      setVoiceStatus("")
    }

    recognition.onerror = () => {
      setVoiceRecording(false)
      setVoiceStatus("")
      recognitionRef.current = null
    }

    recognition.start()
  }

  function stopVoiceCapture() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setVoiceRecording(false)
  }

  async function confirmVoiceTasks() {
    const text = voiceTranscriptRef.current
    if (!text?.trim()) { setVoiceStatus(""); return }
    setVoiceStatus("thinking")
    try {
      const newTasks = await parseTasksFromText(text)
      setTasks(prev => [...newTasks, ...prev])
      setVoiceTranscript("")
      setVoiceStatus("")
    } catch (e) {
      // Without this, a thrown error left the box stuck on "Adding…" forever
      // with the text trapped and no way to recover except a page refresh.
      setVoiceStatus("Couldn't add that — try again")
      setTimeout(() => setVoiceStatus(""), 3000)
    }
  }

  async function submitDateTask() {
    const text = dateTaskInput.trim()
    if (!text || !addingForDate) return
    setDateTaskInput("")
    const parsed = await parseTasksFromText(text)
    // Force every parsed task onto the day that was actually clicked — the point
    // of adding from a specific calendar day is that date is already decided,
    // even if the AI's own date-parsing on the text would've guessed differently.
    const dated = parsed.map(t => ({ ...t, date: addingForDate }))
    setTasks(prev => [...dated, ...prev])
  }

  // Ref to capture latest transcript value inside async callback
  const voiceTranscriptRef = typeof window !== "undefined"
    ? { current: voiceTranscript }
    : { current: "" }

  // Keep ref in sync
  if (typeof window !== "undefined") voiceTranscriptRef.current = voiceTranscript

  async function addTask() {
    const text = taskInput.trim()
    if (!text) return
    setTaskInput("")
    setTaskAdding(true)
    const newTasks = await parseTasksFromText(text)
    setTasks(prev => [...newTasks, ...prev])
    setTaskAdding(false)
  }

  function toggleTask(id) {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t
      const nowDone = !t.done
      // If marking done and came from email, remember that email as handled
      if (nowDone && t.emailKey) {
        setHandledEmails(prev => {
          const next = new Set(prev)
          next.add(t.emailKey)
          try { localStorage.setItem("nona_handled_emails", JSON.stringify([...next])) } catch {}
          return next
        })
      }
      return { ...t, done: nowDone }
    }))
  }

  function deleteTask(id) {
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  function updateTask(id, updates) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }

  const categories = getCategories(profile)

  const filteredTasks = tasks.filter(t => {
    if (t.isEvent) return false // scheduled events live in the calendar, not the Tasks list
    if (taskFilter === "done") return t.done
    if (taskFilter === "all") return !t.done
    return !t.done && t.tag === taskFilter
  })

  function groupTasks(list) {
    if (taskGroupBy === "none") return [{ label: null, items: list }]

    if (taskGroupBy === "tag") {
      const groups = {}
      list.forEach(t => {
        const key = t.tag || "untagged"
        if (!groups[key]) groups[key] = []
        groups[key].push(t)
      })
      // Known categories first (in the user's own order), then any leftover tag
      // values that don't match a current category (e.g. from a category since
      // renamed or deleted) so those tasks stay visible instead of disappearing,
      // then untagged last.
      const knownIds = categories.map(c => c.id)
      const orphanIds = Object.keys(groups).filter(k => k !== "untagged" && !knownIds.includes(k))
      const order = [...knownIds, ...orphanIds, "untagged"]
      return order.filter(k => groups[k]?.length).map(k => ({
        label: k === "untagged" ? "No tag" : categoryLabel(k, categories),
        items: groups[k],
      }))
    }

    // group by date
    const groups = {}
    list.forEach(t => {
      const key = t.date || "no-date"
      if (!groups[key]) groups[key] = []
      groups[key].push(t)
    })
    const dateKeys = Object.keys(groups).filter(k => k !== "no-date").sort()
    const result = dateKeys.map(k => ({ label: formatDateShort(k), items: groups[k] }))
    if (groups["no-date"]) result.push({ label: "No date", items: groups["no-date"] })
    return result
  }

  const groupedTasks = groupTasks(filteredTasks)

  // ── greeting ──────────────────────────────────────────────────────────
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
  const firstName = (profile.name || "Teodora").split(" ")[0]
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })

  // ── RENDER ────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Nona</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Nona" />
        <meta name="theme-color" content="#FBF6EE" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        /* Warm light theme (24 Jul 2026) — variable names kept as-is to avoid a
           mass rename across ~120 usages, but roles shifted: --black is now the
           contrast color used on top of --gold-filled buttons/badges (white,
           since the new accent is a saturated coral rather than a light gold),
           --white is now the primary ink text color, and page background moved
           to its own --bg since bg and button-contrast-text are no longer the
           same color the way black/gold were. */
        :root {
          --bg: #FBF6EE; --black: #FFFFFF; --gold: #FF6B4A; --gold-dim: rgba(255,107,74,0.12);
          --gold-mid: rgba(255,107,74,0.35); --white: #2A2733;
          --muted: rgba(42,39,51,0.5); --surface: #FFFFFF;
          --border: rgba(42,39,51,0.08); --radius: 16px;
          --shadow: 0 1px 2px rgba(42,39,51,0.04), 0 4px 12px rgba(42,39,51,0.05);
        }
        html, body { height: 100%; background: var(--bg); color: var(--white);
          font-family: 'Syne', sans-serif; overflow: hidden;
          -webkit-tap-highlight-color: transparent; -webkit-font-smoothing: antialiased; }
        #__next { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
        .serif { font-family: 'Instrument Serif', serif; font-weight: 400; }
        .gold { color: var(--gold); }
        .muted { color: var(--muted); }
        button { font-family: 'Syne', sans-serif; cursor: pointer; border: none; background: none; }
        input, textarea, select { font-family: 'Syne', sans-serif; }

        /* Scroll */
        .scroll { flex: 1; overflow-y: auto; padding: 20px 20px 40px; -webkit-overflow-scrolling: touch; }
        .scroll::-webkit-scrollbar { display: none; }

        /* Cards */
        .card { background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 18px; margin-bottom: 14px; position: relative; overflow: hidden;
          box-shadow: var(--shadow); }
        .card-accent::before { content: ''; position: absolute; top: 0; left: 0; right: 0;
          height: 2px; background: linear-gradient(90deg, var(--gold), transparent); }

        /* Labels */
        .label { font-size: 10px; color: var(--gold); letter-spacing: 0.1em;
          text-transform: uppercase; font-weight: 600; margin-bottom: 10px; display: block; }

        /* Inputs */
        .input { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          color: var(--white); font-size: 15px; padding: 13px 16px; outline: none; width: 100%;
          transition: border-color 0.2s; }
        .input::placeholder { color: var(--muted); }
        .input:focus { border-color: var(--gold-mid); }
        textarea.input { resize: none; line-height: 1.5; }
        .capture-box:focus-within { border-color: var(--gold-mid) !important; }

        /* Buttons */
        .btn { border-radius: 12px; font-size: 15px; font-weight: 600;
          padding: 14px 20px; width: 100%; transition: opacity 0.15s; }
        .btn:active { opacity: 0.8; }
        .btn-gold { background: var(--gold); color: var(--black); }
        .btn-outline { background: transparent; border: 1px solid var(--border);
          color: var(--muted); font-size: 14px; padding: 12px; }
        .btn-sm { background: none; border: 1px solid var(--border); border-radius: 8px;
          color: var(--muted); font-size: 12px; padding: 7px 12px;
          display: inline-flex; align-items: center; gap: 5px; }
        .btn-sm:hover { border-color: var(--gold-mid); color: var(--gold); }

        /* Chips */
        .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
        .chip { background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
          color: var(--muted); font-size: 12px; padding: 6px 12px; transition: all 0.15s; }
        .chip.on { background: var(--gold-dim); border-color: var(--gold-mid); color: var(--gold); }

        /* Task */
        .task { display: flex; align-items: flex-start; gap: 12px; background: var(--surface);
          border: 1px solid var(--border); border-radius: 12px; padding: 13px 14px; margin-bottom: 8px; }
        .task.done { opacity: 0.4; }
        .task-check { width: 20px; height: 20px; border: 1.5px solid var(--border); border-radius: 50%;
          flex-shrink: 0; cursor: pointer; margin-top: 1px; display: flex; align-items: center;
          justify-content: center; transition: all 0.2s; }
        .task.done .task-check { background: var(--gold); border-color: var(--gold); }
        .task-text { flex: 1; font-size: 14px; color: var(--white); line-height: 1.4; }
        .task.done .task-text { text-decoration: line-through; color: var(--muted); }
        .task-tag { font-size: 10px; color: var(--gold); background: var(--gold-dim);
          border-radius: 4px; padding: 2px 6px; font-weight: 600; letter-spacing: 0.06em;
          text-transform: uppercase; white-space: nowrap; }
        .task-email-badge { font-size: 9px; color: var(--muted); background: var(--surface);
          border-radius: 4px; padding: 2px 5px; border: 1px solid var(--border); }
        .task-del { color: var(--muted); padding: 2px; font-size: 18px; line-height: 1;
          opacity: 0.5; transition: opacity 0.2s; }
        .task-del:hover { opacity: 1; }

        /* Header */
        .header { display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 10px; flex-shrink: 0; position: relative; }

        /* Tabs */
        .tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; padding: 0 20px; }
        .tab-btn { flex: 1; background: none; border: none; color: var(--muted); font-size: 12px;
          font-weight: 500; padding: 10px 4px; border-bottom: 2px solid transparent;
          margin-bottom: -1px; transition: all 0.2s; letter-spacing: 0.04em; }
        .tab-btn.on { color: var(--gold); border-bottom-color: var(--gold); }

        /* Email triage */
        .triage-section { margin-bottom: 16px; }
        .triage-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
        .triage-item { background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; padding: 11px 14px; margin-bottom: 6px; }
        .triage-from { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
        .triage-subject { font-size: 14px; color: var(--white); margin-bottom: 4px; }
        .triage-reason { font-size: 12px; color: var(--gold); font-style: italic; }

        /* Typing */
        .typing { display: inline-flex; gap: 3px; align-items: center; }
        .typing span { width: 4px; height: 4px; background: var(--gold); border-radius: 50%;
          animation: blink 1.2s infinite; }
        .typing span:nth-child(2) { animation-delay: 0.2s; }
        .typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink { 0%,80%,100% { opacity:0.3; transform:scale(0.8); } 40% { opacity:1; transform:scale(1); } }

        /* Onboarding */
        .ob { display: flex; flex-direction: column; justify-content: center; align-items: center;
          height: 100dvh; padding: 40px 28px; text-align: center; gap: 0; overflow-y: auto; }
        .ob-logo { font-family: 'Instrument Serif', serif; font-size: 52px; color: var(--gold);
          letter-spacing: -1px; margin-bottom: 6px; }
        .ob-tag { font-size: 12px; color: var(--muted); letter-spacing: 0.08em;
          text-transform: uppercase; margin-bottom: 44px; }
        .ob-step { width: 100%; display: flex; flex-direction: column; gap: 14px; text-align: left; }
        .ob-step h2 { font-family: 'Instrument Serif', serif; font-size: 26px; color: var(--white);
          line-height: 1.3; font-weight: 400; }
        .ob-step p { font-size: 14px; color: var(--muted); line-height: 1.6; }
        .field-label { font-size: 11px; color: var(--gold); letter-spacing: 0.08em;
          text-transform: uppercase; font-weight: 600; display: block; margin-bottom: 5px; }
        .dots { display: flex; gap: 6px; justify-content: center; margin-top: 20px; }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
        .dot.on { background: var(--gold); }

        /* Connect */
        .connect-btn { display: flex; align-items: center; gap: 12px; background: var(--surface);
          border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; width: 100%;
          transition: border-color 0.2s; margin-bottom: 10px; text-align: left; }
        .connect-btn:hover { border-color: var(--gold-mid); }
        .connect-btn.connected { border-color: rgba(100,200,100,0.3); }
        .connect-icon { font-size: 22px; flex-shrink: 0; }
        .connect-label { font-size: 14px; color: var(--white); }
        .connect-sub { font-size: 12px; color: var(--muted); }
        .connect-status { margin-left: auto; font-size: 12px; color: var(--muted); }
        .connect-status.on { color: #7CCA7C; }

        .settings-row { display: flex; align-items: center; justify-content: space-between;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 14px 16px; margin-bottom: 8px; }
        .ctx-val { font-size: 13px; color: var(--muted); }

        em { font-family: 'Instrument Serif', serif; font-style: italic; color: var(--gold); font-size: 15px; }
      `}</style>

      {!onboarded ? (
        // ═══════════════ ONBOARDING ═══════════════
        <div className="ob">
          <div className="ob-logo">nona</div>
          <div className="ob-tag">your personal AI</div>
          <div className="ob-step">
            {obStep === 1 && <>
              <span style={{ fontSize: 10, color: "var(--gold)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>Step 1 of 3</span>
              <h2>Let's make this yours.</h2>
              <p>A few things so Nona knows how to start your day.</p>
              <div><label className="field-label">Your name</label>
                <input className="input" value={obName} onChange={e => setObName(e.target.value)} placeholder="Teodora" /></div>
              <div><label className="field-label">Your child's name & age</label>
                <input className="input" value={obChild} onChange={e => setObChild(e.target.value)} placeholder="e.g. Timothée, 3 years" /></div>
              <div><label className="field-label">Morning brief time</label>
                <input className="input" type="time" value={obTime} onChange={e => setObTime(e.target.value)} /></div>
              <button className="btn btn-gold" onClick={obNext}>Continue →</button>
              <div className="dots"><div className="dot on" /><div className="dot" /><div className="dot" /></div>
            </>}

            {obStep === 2 && <>
              <span style={{ fontSize: 10, color: "var(--gold)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>Step 2 of 3</span>
              <h2>What's on your mind today?</h2>
              <p>Brain dump everything — Nona will organise it into tasks.</p>
              <div><label className="field-label">Today's mental load</label>
                <textarea className="input" rows={4} value={obLoad} onChange={e => setObLoad(e.target.value)} placeholder="Call crèche about Thursday, check gym shoes, send invoice, dentist…" /></div>
              <div><label className="field-label">What's {obChild || "your child"} doing today?</label>
                <input className="input" value={obCreche} onChange={e => setObCreche(e.target.value)} placeholder="e.g. crèche until 18h, swimming at 17h" /></div>
              <button className="btn btn-gold" onClick={obNext} disabled={obParsing}>{obParsing ? "Organising…" : "Continue →"}</button>
              <button className="btn btn-outline" onClick={obNext} disabled={obParsing}>Skip</button>
              <div className="dots"><div className="dot" /><div className="dot on" /><div className="dot" /></div>
            </>}

            {obStep === 3 && <>
              <span style={{ fontSize: 10, color: "var(--gold)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>Step 3 of 3</span>
              <h2>What are you working on?</h2>
              <p>So Nona knows what matters most right now.</p>
              <div><label className="field-label">Current focus</label>
                <textarea className="input" rows={3} value={obWork} onChange={e => setObWork(e.target.value)} placeholder="Job search (VP ops roles) + building Nona startup. French exam September. AWS certs July." /></div>
              <button className="btn btn-gold" onClick={obNext}>Start my day →</button>
              <button className="btn btn-outline" onClick={obNext}>Skip</button>
              <div className="dots"><div className="dot" /><div className="dot" /><div className="dot on" /></div>
            </>}
          </div>
        </div>
      ) : (
        // ═══════════════ MAIN APP ═══════════════
        <>
          <div className="header">
            {tab === "home" ? (
              <>
                <button onClick={() => setTab("settings")} title="Your profile" style={{ padding: 0, lineHeight: 0 }}>
                  {renderAvatar(32)}
                </button>
                <span className="serif" style={{ fontSize: 22, color: "var(--gold)", position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>nona</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{dateStr}</span>
                  <button onClick={() => setTab("settings")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: "50%", background: "var(--surface)", border: "1px solid var(--border)" }} title="Settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setTab("home")} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--gold)", fontSize: 14 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6" /></svg>
                  Back
                </button>
                <span style={{ fontSize: 14, color: "var(--white)", fontWeight: 600 }}>
                  {tab === "tasks" ? "Tasks" : tab === "mail" ? "Mail" : "Settings"}
                </span>
              </>
            )}
          </div>

          <div className="scroll">

            {/* ── HOME ── */}
            {tab === "home" && <>
              <div style={{ marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div className="serif" style={{ fontSize: 20 }}>{greeting}, {firstName}</div>
                {weather && (
                  <div style={{ background: "var(--gold-dim)", border: "1px solid var(--border)", borderRadius: 14, padding: "8px 14px", textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 16, color: "var(--gold)", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {weatherIcon(weather.code)} {weather.temp !== null ? `${weather.temp}°` : "–"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{weatherLabel(weather.code)}</div>
                  </div>
                )}
              </div>

              {/* Morning brief — everything that needs attention today */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span className="label" style={{ marginBottom: 0 }}>☀️ Today</span>
                <button onClick={generateBrief} disabled={briefLoading} style={{ fontSize: 11, color: "var(--muted)" }}>{briefLoading ? "…" : "↺ Refresh"}</button>
              </div>
              <div className="card" style={{ marginBottom: 20 }}>
                {briefLoading ? (
                  <div style={{ padding: "6px 0", fontSize: 13, color: "var(--muted)" }}>Getting your day together…</div>
                ) : brief ? (
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--white)", whiteSpace: "pre-line" }}>{brief}</div>
                ) : (
                  <div style={{ padding: "6px 0", fontSize: 13, color: "var(--muted)" }}>Nothing loaded yet.</div>
                )}
              </div>

              {/* Week calendar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span className="label" style={{ marginBottom: 0 }}>📅 {getWeekLabel(weekOffset)}</span>
                <div style={{ display: "flex", gap: 14 }}>
                  <button onClick={() => setWeekOffset(weekOffset - 1)} style={{ color: "var(--muted)", fontSize: 14 }}>‹</button>
                  <button onClick={() => setWeekOffset(weekOffset + 1)} style={{ color: "var(--muted)", fontSize: 14 }}>›</button>
                </div>
              </div>
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                  {getWeekDays(weekOffset).map(d => (
                    <button key={d.iso}
                      onClick={() => { setAddingForDate(addingForDate === d.iso ? null : d.iso); setDateTaskInput("") }}
                      style={{
                        textAlign: "center", padding: "3px 0 1px", borderRadius: 8,
                        background: addingForDate === d.iso ? "var(--gold-dim)" : "transparent",
                      }}
                    >
                      <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 6 }}>{d.label}</div>
                      <div style={{
                        width: 26, height: 26, margin: "0 auto", borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
                        background: d.isToday ? "var(--gold-dim)" : "transparent",
                        border: d.isToday ? "1px solid var(--gold)" : addingForDate === d.iso ? "1px solid var(--gold-mid)" : "none",
                        color: d.isToday ? "var(--gold)" : "var(--white)",
                        fontWeight: d.isToday ? 600 : 400,
                      }}>{d.num}</div>
                      {d.tasks.length > 0 && (
                        <div style={{ width: 4, height: 4, borderRadius: "50%", background: d.isToday ? "var(--gold)" : "rgba(255,107,74,0.5)", margin: "5px auto 0" }} />
                      )}
                    </button>
                  ))}
                </div>

                {addingForDate && (
                  <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      className="input"
                      style={{ flex: 1, padding: "9px 12px", fontSize: 13 }}
                      value={dateTaskInput}
                      onChange={e => setDateTaskInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitDateTask() } }}
                      placeholder={`Add to ${formatDateShort(addingForDate)}…`}
                      autoFocus
                    />
                    <button onClick={submitDateTask} style={{ background: "var(--gold)", border: "none", borderRadius: 10, width: 36, height: 36, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" width="14" height="14">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    <button onClick={() => { setAddingForDate(null); setDateTaskInput("") }} style={{ color: "var(--muted)", fontSize: 18, padding: "0 4px", flexShrink: 0 }}>×</button>
                  </div>
                )}

                {getWeekDays(weekOffset).some(d => d.tasks.length > 0) && (
                  <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    {getWeekDays(weekOffset).filter(d => d.tasks.length > 0).map(d => (
                      d.tasks.map(t => (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: d.isToday ? "var(--gold)" : "rgba(255,107,74,0.5)", flexShrink: 0 }} />
                          <div style={{ width: 44, flexShrink: 0, color: "var(--muted)", fontSize: 12 }}>{d.isToday ? "Today" : d.date.toLocaleDateString("en-GB", { weekday: "short" })}</div>
                          <div style={{ color: "var(--white)" }}>{t.text}</div>
                        </div>
                      ))
                    ))}
                  </div>
                )}
              </div>

              {/* Quick actions — speak/type anything, or jump into mail */}
              <div style={{ marginBottom: 10 }}>
                <div className="capture-box" style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "var(--surface)", border: `1px solid ${voiceRecording ? "rgba(232,122,122,0.5)" : "var(--border)"}`,
                  borderRadius: 14, padding: "8px 8px 8px 18px", transition: "border-color 0.2s",
                  boxShadow: "var(--shadow)",
                }}>
                  <input
                    className="input"
                    style={{ flex: 1, background: "transparent", border: "none", padding: "8px 0" }}
                    value={voiceTranscript}
                    onChange={e => setVoiceTranscript(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !voiceRecording) { e.preventDefault(); confirmVoiceTasks() } }}
                    readOnly={voiceRecording}
                    disabled={voiceStatus === "thinking"}
                    placeholder={
                      voiceRecording ? "Listening…"
                      : voiceStatus === "thinking" ? "Adding…"
                      : voiceStatus && voiceStatus !== "listening" ? voiceStatus
                      : "Speak or type what's on your mind…"
                    }
                  />
                  <button
                    onClick={voiceRecording ? stopVoiceCapture : voiceTranscript.trim() ? confirmVoiceTasks : startVoiceCapture}
                    disabled={voiceStatus === "thinking"}
                    style={{
                      width: 40, height: 40, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                      background: voiceRecording ? "rgba(232,122,122,0.2)" : voiceTranscript.trim() ? "var(--gold)" : "var(--gold-dim)",
                      border: voiceRecording ? "1.5px solid rgba(232,122,122,0.6)" : voiceTranscript.trim() ? "none" : "1.5px solid var(--gold-mid)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: voiceStatus === "thinking" ? 0.6 : 1, transition: "all 0.2s",
                    }}
                  >
                    {voiceStatus === "thinking" ? (
                      <span className="typing"><span /><span /><span /></span>
                    ) : voiceRecording ? (
                      <svg viewBox="0 0 24 24" fill="#e87a7a" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    ) : voiceTranscript.trim() ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" width="16" height="16">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" width="18" height="18">
                        <rect x="9" y="2" width="6" height="11" rx="3" />
                        <path d="M19 10v1a7 7 0 0 1-14 0v-1" /><line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    )}
                  </button>
                </div>
                {voiceRecording && (
                  <div style={{ display: "flex", gap: 3, alignItems: "center", justifyContent: "center", marginTop: 8 }}>
                    {[0, 0.15, 0.3].map((delay, i) => (
                      <div key={i} style={{ width: 3, height: 16, borderRadius: 2, background: "#e87a7a", animation: `blink 0.8s ${delay}s infinite` }} />
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => { setTab("mail"); fetchEmails(true) }} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 14, textAlign: "left",
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
                padding: "12px 16px", marginBottom: 20, boxShadow: "var(--shadow)",
              }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--gold-dim)", border: "1.5px solid var(--gold-mid)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--white)", fontWeight: 500 }}>Mail</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {triage?.error ? "⚠ Inbox check failed" : (triage?.summary || "Tap to check your inbox")}
                  </div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              {/* Everything captured via "What's on your mind" (voice or typed) — tap through to see it, not shown inline */}
              <button onClick={() => setTab("tasks")} style={{
                width: "100%", display: "flex", alignItems: "center", gap: 14, textAlign: "left",
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
                padding: "12px 16px", marginBottom: 20, boxShadow: "var(--shadow)",
              }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--gold-dim)", border: "1.5px solid var(--gold-mid)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--white)", fontWeight: 500 }}>Notes & Tasks</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    {(() => {
                      const n = tasks.filter(t => !t.done && !t.isEvent).length
                      return n === 0 ? "Nothing yet — tap to add" : `${n} pending`
                    })()}
                  </div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>}

            {/* ── EMAIL ── */}
            {tab === "mail" && <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Inbox triage</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Nona reads and prioritises your emails</div>
              </div>

              {session && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <span style={{
                    fontSize: 11, padding: "5px 10px", borderRadius: 20, border: "1px solid var(--border)",
                    background: session.providers?.google ? "var(--gold-dim)" : "transparent",
                    color: session.providers?.google ? "var(--gold)" : "var(--muted)",
                  }}>
                    {session.providers?.google ? `✓ Gmail — ${session.providers.google.email}` : "✕ Gmail not connected"}
                  </span>
                  <span style={{
                    fontSize: 11, padding: "5px 10px", borderRadius: 20, border: "1px solid var(--border)",
                    background: session.providers?.microsoft ? "var(--gold-dim)" : "transparent",
                    color: session.providers?.microsoft ? "var(--gold)" : "var(--muted)",
                  }}>
                    {session.providers?.microsoft ? `✓ Outlook — ${session.providers.microsoft.email}` : "✕ Outlook not connected"}
                  </span>
                </div>
              )}

              {!session ? (
                <div className="card">
                  <span className="label">Connect your email</span>
                  <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
                    Sign in with Gmail or Outlook. Nona reads your inbox — never writes, never stores your emails.
                  </p>
                  <button className="connect-btn" onClick={() => signIn("google")}>
                    <span className="connect-icon">📧</span>
                    <div><div className="connect-label">Connect Gmail</div><div className="connect-sub">Read-only · Google OAuth</div></div>
                  </button>
                  <button className="connect-btn" onClick={() => signIn("microsoft")}>
                    <span className="connect-icon">📮</span>
                    <div><div className="connect-label">Connect Outlook</div><div className="connect-sub">Read-only · Microsoft OAuth · teodoramicu@outlook.com</div></div>
                  </button>
                </div>
              ) : emailLoading ? (
                <div className="card card-accent">
                  <span className="label">✦ Reading your inbox</span>
                  <span className="typing"><span /><span /><span /></span>
                </div>
              ) : emailError ? (
                <div className="card">
                  <span className="label" style={{ color: "#e87a7a" }}>Error loading emails</span>
                  <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{emailError}</p>
                  <button className="btn-sm" onClick={fetchEmails}>Try again</button>
                </div>
              ) : triage?.error ? (
                <div className="card" style={{ borderColor: "rgba(232,122,122,0.3)" }}>
                  <span className="label" style={{ color: "#e87a7a" }}>Inbox triage failed</span>
                  <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>{triage.error}</p>
                  <button className="btn-sm" onClick={() => { try { localStorage.removeItem("nona_triage") } catch {} fetchEmails(true) }}>Try again</button>
                </div>
              ) : triage ? (<>
                <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "space-between", alignItems: "center" }}>
                  <span className="serif" style={{ fontSize: 18, color: "var(--white)" }}>{triage.summary || "Inbox checked"}</span>
                  <button className="btn-sm" onClick={() => { try { localStorage.removeItem("nona_triage") } catch {} fetchEmails(true) }}>↺ Refresh</button>
                </div>

                {triage.urgent?.length > 0 && (
                  <div className="triage-section">
                    <div className="triage-label" style={{ color: "#e87a7a" }}>🔴 Urgent</div>
                    {triage.urgent.map(item => {
                      const e = emails[item.index - 1]
                      return e ? (
                        <div key={item.index} className="triage-item" style={{ borderColor: "rgba(232,122,122,0.2)" }}>
                          <div style={{ flex: 1 }}>
                            <div className="triage-from">{e.from?.split("<")[0]?.trim()}</div>
                            <div className="triage-subject">{e.subject}</div>
                            <div className="triage-reason">{item.reason}</div>
                          </div>
                          <button className="task-del" style={{ fontSize: 18, marginLeft: 8, alignSelf: "flex-start" }} onClick={() => dismissEmail(e)} title="Dismiss permanently">×</button>
                        </div>
                      ) : null
                    })}
                  </div>
                )}

                {triage.action?.length > 0 && (
                  <div className="triage-section">
                    <div className="triage-label" style={{ color: "var(--gold)" }}>🟡 Action needed</div>
                    {triage.action.map(item => {
                      const e = emails[item.index - 1]
                      return e ? (
                        <div key={item.index} className="triage-item">
                          <div style={{ flex: 1 }}>
                            <div className="triage-from">{e.from?.split("<")[0]?.trim()}</div>
                            <div className="triage-subject">{e.subject}</div>
                            <div className="triage-reason">{item.reason}</div>
                          </div>
                          <button className="task-del" style={{ fontSize: 18, marginLeft: 8, alignSelf: "flex-start" }} onClick={() => dismissEmail(e)} title="Dismiss permanently">×</button>
                        </div>
                      ) : null
                    })}
                  </div>
                )}

                {(!triage.urgent || triage.urgent.length === 0) && (!triage.action || triage.action.length === 0) && (
                  <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--muted)", fontSize: 14 }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
                    Nothing needs your attention right now.
                  </div>
                )}

                {triage.tasks?.length > 0 && (
                  <div className="card" style={{ borderColor: "rgba(100,200,100,0.2)" }}>
                    <span className="label">✅ Tasks extracted from email</span>
                    {triage.tasks.map((t, i) => (
                      <div key={i} style={{ fontSize: 14, color: "var(--white)", padding: "6px 0", borderBottom: i < triage.tasks.length - 1 ? "1px solid var(--border)" : "none" }}>
                        {t}
                      </div>
                    ))}
                    <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>These have been added to your task list.</p>
                  </div>
                )}

                <button className="btn-sm" style={{ marginTop: 4, marginBottom: showAllEmails ? 10 : 0 }} onClick={() => setShowAllEmails(!showAllEmails)}>
                  {showAllEmails ? "Hide" : "Show"} all {emails.length} emails Nona looked at
                </button>

                {showAllEmails && (
                  <div style={{ marginTop: 4 }}>
                    {emails.map((e, i) => {
                      const isUrgent = triage.urgent?.some(u => u.index === i + 1)
                      const isAction = triage.action?.some(a => a.index === i + 1)
                      const flagged = isUrgent || isAction
                      const added = addedTaskIndices.includes(i)
                      return (
                        <div key={i} className="triage-item" style={{ opacity: flagged ? 1 : 0.55, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="triage-from">{e.from?.split("<")[0]?.trim()} · {e.source}</div>
                            <div className="triage-subject">{e.subject}</div>
                          </div>
                          {!flagged && (
                            <button className="btn-sm" style={{ flexShrink: 0, fontSize: 11, padding: "5px 9px", opacity: added ? 0.5 : 1 }}
                              disabled={added}
                              onClick={() => addEmailAsTask(e, i)}>
                              {added ? "✓ Added" : "+ Add as task"}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>) : (
                <div style={{ textAlign: "center", padding: "48px 16px", color: "var(--muted)", fontSize: 14 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
                  Connected as {session.user?.email}
                  <br /><br />
                  <button className="btn btn-gold" style={{ width: "auto", padding: "12px 24px" }} onClick={() => fetchEmails(true)}>Load & triage my inbox</button>
                </div>
              )}
            </>}

            {/* ── TASKS ── */}
            {tab === "tasks" && <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Mental load</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Everything in your head, in one place</div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input className="input" style={{ flex: 1 }} value={taskInput}
                  onChange={e => setTaskInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTask() } }}
                  placeholder="Add anything — even multiple tasks with dates…" disabled={taskAdding} />
                <button onClick={addTask} disabled={taskAdding} style={{ background: "var(--gold)", border: "none", borderRadius: 12, width: 48, height: 48, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: taskAdding ? 0.6 : 1 }}>
                  {taskAdding ? (
                    <span className="typing"><span /><span /><span /></span>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                </button>
              </div>

              <div className="chips">
                {[["all", "All"], ["today", "Today"], ...categories.map(c => [c.id, c.label]), ["done", "Done"]].map(([f, label]) => (
                  <button key={f} className={`chip ${taskFilter === f ? "on" : ""}`} onClick={() => setTaskFilter(f)}>
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {[["date", "By date"], ["tag", "By tag"], ["none", "All"]].map(([key, label]) => (
                  <button key={key} className={`chip ${taskGroupBy === key ? "on" : ""}`} style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setTaskGroupBy(key)}>
                    {label}
                  </button>
                ))}
              </div>

              {filteredTasks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🧠</div>
                  {taskFilter === "done" ? "Nothing done yet — your wins will show here." : "Add your first task above. Nona keeps track so you don't have to."}
                </div>
              ) : groupedTasks.map((group, gi) => (
                <div key={gi} style={{ marginBottom: 4 }}>
                  {group.label && (
                    <div style={{ fontSize: 11, color: group.label === "No date" || group.label === "No tag" ? "var(--muted)" : "var(--gold)", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", margin: "14px 0 8px" }}>
                      {group.label}
                    </div>
                  )}
                  {group.items.map(t => {
                    const isEditing = editingTaskId === t.id
                    return (
                      <div key={t.id} className={`task ${t.done ? "done" : ""}`} style={{ flexWrap: isEditing ? "wrap" : "nowrap" }}>
                        <div className="task-check" onClick={() => toggleTask(t.id)}>
                          {t.done && <svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12" /></svg>}
                        </div>
                        {isEditing ? (
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                            <input className="input" style={{ fontSize: 14, padding: "8px 10px" }} value={t.text}
                              onChange={e => updateTask(t.id, { text: e.target.value })}
                              onKeyDown={e => { if (e.key === "Enter") setEditingTaskId(null) }} autoFocus />
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <input type="date" className="input" style={{ fontSize: 12, padding: "6px 8px", width: "auto" }}
                                value={t.date || ""} onChange={e => updateTask(t.id, { date: e.target.value || null })} />
                              <select className="input" style={{ fontSize: 12, padding: "6px 8px", width: "auto" }}
                                value={t.tag || ""} onChange={e => updateTask(t.id, { tag: e.target.value || null })}>
                                <option value="">No tag</option>
                                {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                              </select>
                              <button className="btn-sm" onClick={() => setEditingTaskId(null)}>Done</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {t.date && (
                              <div style={{ fontSize: 11, color: "var(--gold)", fontWeight: 600, flexShrink: 0, minWidth: 48 }}>
                                {parseLocalDate(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setEditingTaskId(t.id)}>
                              <div className="task-text">{t.text}</div>
                              {t.description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{t.description}</div>}
                            </div>
                            {t.fromEmail && <span className="task-email-badge">📧</span>}
                            {t.tag && <span className="task-tag">{categoryLabel(t.tag, categories)}</span>}
                            <button className="task-del" onClick={() => deleteTask(t.id)}>×</button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </>}

            {/* ── ME ── */}
            {tab === "settings" && <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>{profile.name || "Your profile"}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>What Nona knows about your life</div>
              </div>

              <div className="card" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
                {renderAvatar(56)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Avatar</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <input type="file" id="avatar-upload" accept="image/*" style={{ display: "none" }} onChange={handleAvatarFile} />
                    <label htmlFor="avatar-upload" className="btn-sm" style={{ cursor: "pointer" }}>Upload photo</label>
                    {profile.avatarUrl && (
                      <button className="btn-sm" onClick={() => setProfile(p => ({ ...p, avatarUrl: null }))}>Remove photo</button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {AVATAR_COLORS.map(c => (
                      <button key={c} title="Use this color" onClick={() => setProfile(p => ({ ...p, avatarColor: c }))}
                        style={{
                          width: 22, height: 22, borderRadius: "50%", background: c, flexShrink: 0,
                          border: (profile.avatarColor || AVATAR_COLORS[0]) === c ? "2px solid var(--white)" : "2px solid transparent",
                        }} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 20 }}>
                {[
                  { icon: "👶", label: "Child", key: "child" },
                  { icon: "💼", label: "Work focus", key: "work" },
                  { icon: "⏰", label: "Brief time", key: "briefTime" },
                  { icon: "🗣", label: "Voice language", key: "language" },
                ].map(({ icon, label, key }) => (
                  <div key={key} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 14 }}>
                        {key === "language"
                          ? { "en-GB": "English", "fr-FR": "Français", "de-DE": "Deutsch", "ro-RO": "Română", "it-IT": "Italiano" }[profile[key]] || profile[key] || "English"
                          : profile[key] || "—"}
                      </div>
                    </div>
                    <button className="btn-sm" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => {
                      if (key === "language") {
                        const langs = { "English": "en-GB", "Français": "fr-FR", "Deutsch": "de-DE", "Română": "ro-RO", "Italiano": "it-IT" }
                        const choice = prompt("Choose language:\n1. English\n2. Français\n3. Deutsch\n4. Română\n5. Italiano\n\nType the language name:", "English")
                        if (choice && langs[choice]) setProfile(p => ({ ...p, language: langs[choice] }))
                      } else {
                        const val = prompt(`Edit ${label}`, profile[key] || "")
                        if (val !== null) setProfile(p => ({ ...p, [key]: val }))
                      }
                    }}>edit</button>
                  </div>
                ))}
                <div style={{ paddingTop: 10 }} />
              </div>

              <div style={{ marginBottom: 20 }}>
                <button
                  onClick={handleTogglePush}
                  disabled={pushBusy}
                  className="btn-sm"
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    borderRadius: 12,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--white)",
                    textAlign: "left",
                    fontSize: 15,
                  }}
                >
                  {pushBusy ? "Working…" : pushEnabled ? "🔔 Morning reminders: On" : "🔕 Enable morning reminders"}
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 4px" }}>
                <span style={{ fontSize: 10, color: "var(--gold)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>Email</span>
                {(session?.providers?.google || session?.providers?.microsoft) && (
                  <button className="btn-sm" style={{ fontSize: 11, color: "#e87a7a" }} onClick={() => signOut()}>Disconnect all</button>
                )}
              </div>
              {session?.providers?.google ? (
                <div className="settings-row">
                  <div>
                    <div style={{ fontSize: 14 }}>Gmail connected ✓</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{session.providers.google.email}</div>
                  </div>
                  <button className="btn-sm" disabled={disconnectingProvider === "google"} onClick={() => disconnectProvider("google")}>
                    {disconnectingProvider === "google" ? "…" : "Disconnect"}
                  </button>
                </div>
              ) : (
                <div className="settings-row">
                  <div style={{ fontSize: 14 }}>Gmail not connected</div>
                  <button className="btn-sm" onClick={() => signIn("google")}>Connect →</button>
                </div>
              )}

              {session?.providers?.microsoft ? (
                <div className="settings-row">
                  <div>
                    <div style={{ fontSize: 14 }}>Outlook connected ✓</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{session.providers.microsoft.email}</div>
                  </div>
                  <button className="btn-sm" disabled={disconnectingProvider === "microsoft"} onClick={() => disconnectProvider("microsoft")}>
                    {disconnectingProvider === "microsoft" ? "…" : "Disconnect"}
                  </button>
                </div>
              ) : (
                <div className="settings-row">
                  <div style={{ fontSize: 14 }}>Outlook not connected</div>
                  <button className="btn-sm" onClick={() => signIn("microsoft")}>Connect →</button>
                </div>
              )}

              <div style={{ marginTop: 24, marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>🏷️ Task categories</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Used to group tasks and to auto-tag ones pulled from email. Tap a name to rename it — existing tasks keep up automatically.</div>
                {categories.map(c => (
                  <div key={c.id} className="settings-row" style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 13, color: "var(--white)", cursor: "pointer" }} onClick={() => {
                      const label = prompt("Rename category:", c.label)
                      if (label?.trim()) setProfile(p => ({ ...p, categories: getCategories(p).map(x => x.id === c.id ? { ...x, label: label.trim() } : x) }))
                    }}>{c.label}</div>
                    <button className="btn-sm" style={{ fontSize: 11, color: "#e87a7a" }} onClick={() => {
                      if (confirm(`Remove "${c.label}"? Tasks already tagged with it stay as they are, just ungrouped.`)) {
                        setProfile(p => ({ ...p, categories: getCategories(p).filter(x => x.id !== c.id) }))
                      }
                    }}>Remove</button>
                  </div>
                ))}
                <button className="btn-sm" style={{ marginTop: 6 }} onClick={() => {
                  const label = prompt("New category name:")
                  if (label?.trim()) setProfile(p => {
                    const current = getCategories(p)
                    const id = slugifyCategoryId(label.trim(), current.map(x => x.id))
                    return { ...p, categories: [...current, { id, label: label.trim() }] }
                  })
                }}>+ Add category</button>
              </div>

              <div style={{ marginTop: 24, marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>🚫 Email filter rules</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>These senders or subjects will never appear in triage again.</div>
                {(profile.emailFilters || []).map((rule, i) => (
                  <div key={i} className="settings-row" style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 13, color: "var(--white)" }}>{rule}</div>
                    <button className="btn-sm" style={{ fontSize: 11, color: "#e87a7a" }} onClick={() => setProfile(p => ({ ...p, emailFilters: p.emailFilters.filter((_, j) => j !== i) }))}>Remove</button>
                  </div>
                ))}
                <button className="btn-sm" style={{ marginTop: 6 }} onClick={() => {
                  const rule = prompt("Add filter rule — any email containing this sender name or subject will be permanently hidden:\n\nExamples: 'password change', 'Microsoft account team', 'no-reply@'")
                  if (rule?.trim()) setProfile(p => ({ ...p, emailFilters: [...(p.emailFilters || []), rule.trim()] }))
                }}>+ Add rule</button>
              </div>

              <div style={{ marginTop: 24, marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>🔁 Recurring</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Repeats every week on the days you pick — e.g. football training every Friday and Saturday. Shows up on the calendar and everywhere else like any task.</div>
                {(profile.recurring || []).map(r => (
                  <div key={r.id} className="settings-row" style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 13, color: "var(--white)" }}>{r.text} <span style={{ color: "var(--muted)", fontSize: 11 }}>({r.days.map(d => DOW_SHORT[d]).join(", ")})</span></div>
                    <button className="btn-sm" style={{ fontSize: 11, color: "#e87a7a" }} onClick={() => removeRecurring(r.id)}>Remove</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  {[0, 1, 2, 3, 4, 5, 6].map(d => (
                    <button key={d} onClick={() => setNewRecurringDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                      style={{
                        width: 32, height: 32, borderRadius: "50%", fontSize: 11, flexShrink: 0,
                        border: newRecurringDays.includes(d) ? "1.5px solid var(--gold)" : "1px solid var(--border)",
                        background: newRecurringDays.includes(d) ? "var(--gold-dim)" : "transparent",
                        color: newRecurringDays.includes(d) ? "var(--gold)" : "var(--muted)",
                      }}>
                      {DOW_SHORT[d][0]}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} value={newRecurringText}
                    onChange={e => setNewRecurringText(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRecurring() } }}
                    placeholder="e.g. Football training" />
                  <button className="btn-sm" onClick={addRecurring} disabled={!newRecurringText.trim() || newRecurringDays.length === 0}>+ Add</button>
                </div>
              </div>

              <div style={{ marginTop: 24 }}>
                <button className="btn btn-outline" onClick={async () => { if (confirm("Reset everything?")) { localStorage.clear(); if (supabase) await supabase.auth.signOut(); window.location.reload() } }}>
                  Reset Nona
                </button>
              </div>

              <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "var(--muted)" }}>
                Nona v0.3 · built for {profile.name || "you"} · {session ? "☁️ syncing to cloud" : "💾 local only"}
              </div>
            </>}

          </div>
        </>
      )}
    </>
  )
}
