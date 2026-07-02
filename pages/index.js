import { useState, useEffect, useCallback } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import Head from "next/head"

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

function guessTag(text) {
  const t = text.toLowerCase()
  if (/crèche|creche|timothée|timothee|school|swim|gym|pick.up|drop.off/.test(t)) return "family"
  if (/job|apply|cv|interview|linkedin|nona|startup|pitch/.test(t)) return "work"
  if (/dentist|doctor|pharmacie|appointment/.test(t)) return "health"
  if (/buy|groceries|lidl|shop/.test(t)) return "errands"
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

// ── component ─────────────────────────────────────────────────────────────
export default function Nona() {
  const { data: session } = useSession()

  const [onboarded, setOnboarded] = useState(false)
  const [obStep, setObStep] = useState(1)
  const [obName, setObName] = useState("")
  const [obChild, setObChild] = useState("")
  const [obTime, setObTime] = useState("07:00")
  const [obLoad, setObLoad] = useState("")
  const [obCreche, setObCreche] = useState("")
  const [obWork, setObWork] = useState("")

  const [profile, setProfile] = useState({ name: "", child: "", briefTime: "07:00", work: "", creche: "", language: "en-GB" })
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
      setTasks(s.tasks || [])
    }
  }, [])

  useEffect(() => {
    if (onboarded) {
      saveState({ onboarded: true, profile, tasks })
    }
  }, [onboarded, profile, tasks])

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
      // Gmail via OAuth (needs session)
      if (session?.provider === "google") {
        const r = await fetch("/api/email/gmail")
        if (r.ok) {
          const d = await r.json()
          allEmails.push(...(d.emails || []))
        }
      }
      // Outlook via IMAP (always available if env vars set)
      const ro = await fetch("/api/email/outlook")
      if (ro.ok) {
        const d = await ro.json()
        allEmails.push(...(d.emails || []))
      }
      if (allEmails.length === 0 && !session) {
        setEmailError("Connect Gmail or configure Outlook to see your emails.")
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
    const filteredList = emailList.filter(e => !handledEmails.has(`${e.from}::${e.subject}`))
    const listToTriage = filteredList.length > 0 ? filteredList : emailList
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "triage",
          emails: listToTriage,
          context: { name: profile.name || "Teodora", child: profile.child || "Timothée" },
        }),
      })
      const text = await r.text()
      let d
      try {
        d = JSON.parse(text)
      } catch(e) {
        // AI returned non-JSON, create a minimal triage object
        d = { urgent: [], action: [], tasks: [], summary: text.slice(0, 300) }
      }
      // Ensure all expected fields exist
      d.urgent = d.urgent || []
      d.action = d.action || []
      d.tasks = d.tasks || []
      d.summary = d.summary || `${emailList.length} emails loaded.`
      setTriage(d)
      saveCache("nona_triage", { triage: d, emails: emailList })
      // Auto-add extracted tasks
      if (d.tasks?.length) {
        const newTasks = d.tasks.map(text => ({
          id: String(Date.now() + Math.random()), text, done: false, tag: "work", fromEmail: true,
        }))
        setTasks(prev => [...newTasks, ...prev])
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
        }),
      })
      const d = await r.json()
      const task = {
        id: String(Date.now() + Math.random()),
        text: d.text || email.subject,
        description: d.description || email.snippet || "",
        date: d.date || null,
        done: false,
        tag: d.tag || "work",
        fromEmail: true,
        emailKey: dupeKey,
      }
      setTasks(prev => [task, ...prev])
    } catch (e) {
      // fallback: still add something rather than fail silently
      setTasks(prev => [{
        id: String(Date.now() + Math.random()), text: email.subject, description: email.snippet || "", date: null, done: false, tag: "work", fromEmail: true, emailKey: dupeKey,
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
  const [voiceTranscript, setVoiceTranscript] = useState("")
  const [voiceStatus, setVoiceStatus] = useState("") // "listening" | "thinking" | ""
  const [taskGroupBy, setTaskGroupBy] = useState("date") // date | tag | none
  const [editingTaskId, setEditingTaskId] = useState(null)

  async function parseTasksFromText(text) {
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "parse_tasks", text }),
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
      const d = new Date(isoDate)
      return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    } catch { return isoDate }
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
      const iso = d.toISOString().slice(0, 10)
      const isToday = iso === today.toISOString().slice(0, 10)
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
    recognition.continuous = false
    recognition.interimResults = true

    setVoiceRecording(true)
    setVoiceStatus("listening")
    setVoiceTranscript("")

    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join("")
      setVoiceTranscript(transcript)
    }

    recognition.onend = async () => {
      setVoiceRecording(false)
      const text = voiceTranscriptRef.current
      if (!text?.trim()) {
        setVoiceStatus("")
        return
      }
      setVoiceStatus("thinking")
      const newTasks = await parseTasksFromText(text)
      setTasks(prev => [...newTasks, ...prev])
      setVoiceTranscript("")
      setVoiceStatus("")
    }

    recognition.onerror = () => {
      setVoiceRecording(false)
      setVoiceStatus("")
    }

    recognition.start()
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

  const TAG_OPTIONS = ["family", "work", "health", "errands"]

  const filteredTasks = tasks.filter(t => {
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
      const order = ["family", "work", "health", "errands", "untagged"]
      return order.filter(k => groups[k]?.length).map(k => ({
        label: k === "untagged" ? "No tag" : k.charAt(0).toUpperCase() + k.slice(1),
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
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Nona" />
        <meta name="theme-color" content="#0D0C0A" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --black: #0D0C0A; --gold: #E8C87A; --gold-dim: rgba(232,200,122,0.13);
          --gold-mid: rgba(232,200,122,0.35); --white: #F5F0E8;
          --muted: rgba(245,240,232,0.45); --surface: rgba(255,255,255,0.04);
          --border: rgba(232,200,122,0.12); --radius: 16px;
        }
        html, body { height: 100%; background: var(--black); color: var(--white);
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
          border-radius: var(--radius); padding: 18px; margin-bottom: 14px; position: relative; overflow: hidden; }
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
          padding: 16px 20px 10px; flex-shrink: 0; }

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
                <span className="serif" style={{ fontSize: 24, color: "var(--gold)" }}>nona</span>
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
                  <div style={{ background: "var(--gold-dim)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", fontSize: 12, color: "var(--gold)", whiteSpace: "nowrap" }}>
                    {weatherIcon(weather.code)} {weather.temp !== null ? `${weather.temp}°` : "–"}
                  </div>
                )}
              </div>

              {/* Voice capture — primary input on home */}
              <div style={{ marginBottom: 20 }}>
                <button
                  onClick={startVoiceCapture}
                  disabled={voiceRecording || voiceStatus === "thinking"}
                  style={{
                    width: "100%", background: voiceRecording ? "rgba(232,122,122,0.15)" : "var(--surface)",
                    border: `1px solid ${voiceRecording ? "rgba(232,122,122,0.5)" : "var(--border)"}`,
                    borderRadius: 14, padding: "16px 20px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 14, transition: "all 0.2s",
                    animation: voiceRecording ? "pulse 1s infinite" : "none",
                  }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: voiceRecording ? "rgba(232,122,122,0.2)" : "var(--gold-dim)",
                    border: `1.5px solid ${voiceRecording ? "rgba(232,122,122,0.6)" : "var(--gold-mid)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke={voiceRecording ? "#e87a7a" : "var(--gold)"} strokeWidth="2" strokeLinecap="round" width="20" height="20">
                      <rect x="9" y="2" width="6" height="11" rx="3"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <line x1="12" y1="19" x2="12" y2="22"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontSize: 14, color: voiceRecording ? "#e87a7a" : "var(--white)", fontWeight: 500 }}>
                      {voiceStatus === "listening" ? "Listening…" : voiceStatus === "thinking" ? "Adding tasks…" : "What's on your mind?"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {voiceTranscript || (voiceStatus === "" ? "Tap to speak — say anything" : "")}
                    </div>
                  </div>
                  {voiceRecording && (
                    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                      {[0, 0.15, 0.3].map((delay, i) => (
                        <div key={i} style={{
                          width: 3, height: 16, borderRadius: 2, background: "#e87a7a",
                          animation: `blink 0.8s ${delay}s infinite`,
                        }} />
                      ))}
                    </div>
                  )}
                </button>
              </div>

              {/* Tasks preview */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span className="label" style={{ marginBottom: 0 }}>🧠 Tasks</span>
                <button onClick={() => setTab("tasks")} style={{ fontSize: 11, color: "var(--muted)" }}>View all ›</button>
              </div>
              <div className="card" style={{ padding: "4px 18px", marginBottom: 20 }}>
                {tasks.filter(t => !t.done).length === 0 ? (
                  <div style={{ padding: "14px 0", fontSize: 13, color: "var(--muted)" }}>Nothing pending — add something on the Tasks page.</div>
                ) : tasks.filter(t => !t.done).slice(0, 4).map((t, i, arr) => (
                  <div key={t.id} className="task" style={{ margin: 0, background: "transparent", border: "none", borderRadius: 0, padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div className="task-check" onClick={() => toggleTask(t.id)}>
                      {t.done && <svg viewBox="0 0 24 24" fill="none" stroke="#0D0C0A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <div className="task-text">{t.text}</div>
                    {t.date && <span className="task-tag" style={{ color: "var(--white)", background: "transparent", border: "1px solid var(--border)" }}>{formatDateShort(t.date)}</span>}
                  </div>
                ))}
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
                    <div key={d.iso} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 9, color: "var(--muted)", marginBottom: 6 }}>{d.label}</div>
                      <div style={{
                        width: 26, height: 26, margin: "0 auto", borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
                        background: d.isToday ? "var(--gold-dim)" : "transparent",
                        border: d.isToday ? "1px solid var(--gold)" : "none",
                        color: d.isToday ? "var(--gold)" : "var(--white)",
                        fontWeight: d.isToday ? 600 : 400,
                      }}>{d.num}</div>
                      {d.tasks.length > 0 && (
                        <div style={{ width: 4, height: 4, borderRadius: "50%", background: d.isToday ? "var(--gold)" : "rgba(232,200,122,0.6)", margin: "5px auto 0" }} />
                      )}
                    </div>
                  ))}
                </div>
                {getWeekDays(weekOffset).some(d => d.tasks.length > 0) && (
                  <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    {getWeekDays(weekOffset).filter(d => d.tasks.length > 0).map(d => (
                      d.tasks.map(t => (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: d.isToday ? "var(--gold)" : "rgba(232,200,122,0.6)", flexShrink: 0 }} />
                          <div style={{ width: 44, flexShrink: 0, color: "var(--muted)", fontSize: 12 }}>{d.isToday ? "Today" : d.date.toLocaleDateString("en-GB", { weekday: "short" })}</div>
                          <div style={{ color: "var(--white)" }}>{t.text}</div>
                        </div>
                      ))
                    ))}
                  </div>
                )}
              </div>

              {/* Mail preview */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span className="label" style={{ marginBottom: 0 }}>📬 Mail</span>
                <button onClick={() => { setTab("mail"); if (!triage) fetchEmails() }} style={{ fontSize: 11, color: "var(--muted)" }}>View all ›</button>
              </div>
              <div className="card" style={{ marginBottom: 20, cursor: "pointer" }} onClick={() => { setTab("mail"); if (!triage) fetchEmails() }}>
                <div style={{ fontSize: 13, color: "var(--white)" }}>
                  {triage?.summary || "Tap to check your inbox"}
                </div>
              </div>

              {/* Budget placeholder */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: "rgba(245,240,232,0.35)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>💳 Budget</span>
                <span style={{ fontSize: 11, color: "rgba(245,240,232,0.25)" }}>Coming soon</span>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(232,200,122,0.1)", borderRadius: 12, padding: 18, marginBottom: 20, textAlign: "center", fontSize: 12, color: "rgba(245,240,232,0.3)" }}>
                Connect a bank account to see spending here
              </div>

              {/* Groceries placeholder */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: "rgba(245,240,232,0.35)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>🛒 Groceries</span>
                <span style={{ fontSize: 11, color: "rgba(245,240,232,0.25)" }}>Coming soon</span>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(232,200,122,0.1)", borderRadius: 12, padding: 18, marginBottom: 20, textAlign: "center", fontSize: 12, color: "rgba(245,240,232,0.3)" }}>
                Connect Lidl or Aldi to track grocery spend
              </div>
            </>}

            {/* ── EMAIL ── */}
            {tab === "mail" && <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Inbox triage</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Nona reads and prioritises your emails</div>
              </div>

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
                  <div className={`connect-btn ${outlookStatus?.ok ? "connected" : ""}`}>
                    <span className="connect-icon">📮</span>
                    <div>
                      <div className="connect-label">Outlook</div>
                      <div className="connect-sub">
                        {outlookStatus === null ? "Checking…" :
                         outlookStatus.ok ? `Connected · ${outlookStatus.email}` :
                         `Not connected — ${outlookStatus.error}`}
                      </div>
                    </div>
                    <span className={`connect-status ${outlookStatus?.ok ? "on" : ""}`}>
                      {outlookStatus === null ? "…" : outlookStatus.ok ? "✓ Ready" : "✕ Error"}
                    </span>
                  </div>
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
              ) : triage ? (<>
                <div style={{ display: "flex", gap: 8, marginBottom: 16, justifyContent: "space-between", alignItems: "center" }}>
                  <span className="serif" style={{ fontSize: 18, color: "var(--white)" }}>{triage.summary || "Inbox checked"}</span>
                  <button className="btn-sm" onClick={() => fetchEmails(true)}>↺ Refresh</button>
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="#0D0C0A" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  )}
                </button>
              </div>

              <div className="chips">
                {["all", "today", "family", "work", "done"].map(f => (
                  <button key={f} className={`chip ${taskFilter === f ? "on" : ""}`} onClick={() => setTaskFilter(f)}>
                    {f === "all" ? "All" : f === "today" ? "Today" : f === "family" ? "Family" : f === "work" ? "Work" : "Done"}
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
                          {t.done && <svg viewBox="0 0 24 24" fill="none" stroke="#0D0C0A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12" /></svg>}
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
                                {TAG_OPTIONS.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                              </select>
                              <button className="btn-sm" onClick={() => setEditingTaskId(null)}>Done</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setEditingTaskId(t.id)}>
                              <div className="task-text">{t.text}</div>
                              {t.description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{t.description}</div>}
                            </div>
                            {t.fromEmail && <span className="task-email-badge">📧</span>}
                            {t.date && taskGroupBy !== "date" && <span className="task-tag" style={{ color: "var(--white)", background: "transparent", border: "1px solid var(--border)" }}>{formatDateShort(t.date)}</span>}
                            {t.tag && <span className="task-tag">{t.tag}</span>}
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

              <div style={{ fontSize: 10, color: "var(--gold)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, marginBottom: 8, padding: "0 4px" }}>Email</div>
              {session ? (
                <div className="settings-row">
                  <div>
                    <div style={{ fontSize: 14 }}>Gmail connected</div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{session.user?.email}</div>
                  </div>
                  <button className="btn-sm" onClick={() => signOut()}>Disconnect</button>
                </div>
              ) : (
                <div className="settings-row">
                  <div style={{ fontSize: 14 }}>Gmail not connected</div>
                  <button className="btn-sm" onClick={() => setTab("mail")}>Connect →</button>
                </div>
              )}

              <div className="settings-row">
                <div>
                  <div style={{ fontSize: 14 }}>
                    Outlook {outlookStatus?.ok ? "connected" : outlookStatus === null ? "checking…" : "not connected"}
                  </div>
                  <div style={{ fontSize: 12, color: outlookStatus?.ok ? "var(--muted)" : "#e87a7a" }}>
                    {outlookStatus === null ? "—" : outlookStatus.ok ? outlookStatus.email : outlookStatus.error}
                  </div>
                </div>
                <button className="btn-sm" onClick={checkOutlookStatus}>Test</button>
              </div>

              <div style={{ marginTop: 24 }}>
                <button className="btn btn-outline" onClick={() => { if (confirm("Reset everything?")) { localStorage.clear(); window.location.reload() } }}>
                  Reset Nona
                </button>
              </div>

              <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "var(--muted)" }}>
                Nona v0.2 · built for {profile.name || "you"}
              </div>
            </>}

          </div>
        </>
      )}
    </>
  )
}
