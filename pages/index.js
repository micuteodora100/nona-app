import { useState } from "react"
import Link from "next/link"
import MarketingLayout from "../components/MarketingLayout"

// Illustrative example tasks for the hero mockup — deliberately generic,
// not real household data, since this page is public.
const MOCK_TASKS = [
  { text: "Pay daycare invoice", tag: "Bills & money", color: "#F6D1C9", rot: -2 },
  { text: "Book dentist for Mia", tag: "Health", color: "#CDEDE6", rot: 1.5 },
  { text: "Pack for weekend trip", tag: "Family", color: "#E3D6F0", rot: -1 },
  { text: "Reply to school re: trip", tag: "Applications", color: "#CFE0F3", rot: 2 },
]

const FEATURES = [
  {
    title: "Daily brief",
    body: "One list of what actually needs attention today, generated fresh every morning — not a wall of unread everything.",
  },
  {
    title: "Email triage",
    body: "Gmail and Outlook read and summarized, action items pulled out automatically. Read-only — Nona never sends, deletes, or stores your emails.",
  },
  {
    title: "Tasks & calendar",
    body: "Speak or type in plain language. Nona parses dates, categorizes automatically, and slots it into the week view — flights and bookings included.",
  },
  {
    title: "Proactive reminders",
    body: "Push notifications surface what matters without you having to open the app and check.",
  },
]

const STEPS = [
  {
    n: "01",
    title: "Connect your inbox",
    body: "Link Gmail and/or Outlook, read-only. One-time setup, a couple of clicks.",
  },
  {
    n: "02",
    title: "Speak or type what's on your mind",
    body: "\"Pay the daycare invoice by Friday.\" Nona parses the date and category — no forms, no dropdowns.",
  },
  {
    n: "03",
    title: "Get a daily brief, not a pile of email",
    body: "Every morning, one list of what actually needs your attention — pulled from your inbox, your tasks, and your calendar.",
  },
]

const ASKS = [
  {
    q: "\"Anything urgent in my inbox?\"",
    a: "Nona reads unread mail from the last 48 hours and surfaces only what needs a decision or a reply — not the noise.",
  },
  {
    q: "\"Pick up the kids' passports renewal, remind me in 6 weeks.\"",
    a: "Parsed into a dated, categorized task automatically — spoken or typed, either way.",
  },
  {
    q: "\"What's this week look like?\"",
    a: "Week view with tasks and auto-detected events — flight confirmations and bookings pulled straight from email.",
  },
]

const FAQS = [
  {
    q: "Is my email data safe?",
    a: "Nona reads your inbox live via OAuth and never stores email content — it's processed in memory per request only. Access is read-only: Nona cannot send, delete, or modify anything in your inbox.",
  },
  {
    q: "What does Nona connect to right now?",
    a: "Gmail and Outlook today, read-only. More integrations are on the roadmap, not yet built.",
  },
  {
    q: "Is this a finished product?",
    a: "No — it's an MVP in active development, built solo. Core flows (brief, tasks, calendar, email triage) work end-to-end today; multi-user support and additional integrations are in progress.",
  },
  {
    q: "Can other people use it besides you?",
    a: "Not broadly yet — that's explicitly the current focus. Sign-in works, but the underlying multi-user data isolation is still being hardened before opening it up further.",
  },
]

function Faq({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="faq-item" onClick={() => setOpen(o => !o)}>
      <div className="faq-q">
        <span>{q}</span>
        <span className="faq-toggle">{open ? "–" : "+"}</span>
      </div>
      {open && <div className="faq-a">{a}</div>}
    </div>
  )
}

export default function Landing() {
  return (
    <MarketingLayout>
      <div className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Your personal AI</div>
          <h1>The mental load of running a household — <em>handled</em>.</h1>
          <p className="sub">
            Nona brings tasks, schedules, email, and family logistics into one daily view,
            using AI to surface what needs attention rather than requiring you to manually
            organize everything.
          </p>
          <div className="cta-row">
            <Link className="btn-primary" href="/login">Sign in</Link>
          </div>
          <div className="status-line">MVP in active development — built independently, using Next.js, Supabase, Claude, and Vercel.</div>
        </div>

        <div className="mock" aria-hidden="true">
          <div className="mock-brief">
            <div className="mock-brief-label">Today's brief</div>
            <div className="mock-brief-item">Daycare invoice due Friday</div>
            <div className="mock-brief-item">Flight to Nice — check in at 6pm</div>
            <div className="mock-brief-item">2 unread emails need a reply</div>
          </div>
          <div className="mock-notes">
            {MOCK_TASKS.map((t, i) => (
              <div
                key={t.text}
                className="mock-note"
                style={{
                  background: t.color,
                  left: `${(i % 2) * 46}%`,
                  top: `${Math.floor(i / 2) * 92 + 30}px`,
                  transform: `rotate(${t.rot}deg)`,
                }}
              >
                {t.text}
                <span className="mock-note-tag">{t.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="block" id="what-it-does">
        <h2>What Nona does</h2>
        <p className="lead">One flow, not five separate apps to keep checking.</p>
        <div className="flow">
          <span className="flow-pill">Daily brief</span>
          <span className="flow-arrow">→</span>
          <span className="flow-pill">Tasks</span>
          <span className="flow-arrow">→</span>
          <span className="flow-pill">Calendar</span>
          <span className="flow-arrow">→</span>
          <span className="flow-pill">Email triage</span>
          <span className="flow-arrow">→</span>
          <span className="flow-pill">Household logistics</span>
          <span className="flow-arrow">→</span>
          <span className="flow-pill">Proactive reminders</span>
        </div>
        <div className="grid">
          {FEATURES.map(f => (
            <div className="card" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block" id="how-it-works">
        <h2>Three steps. No manual organizing.</h2>
        <p className="lead">Nona does the reading and sorting — you just tell it what's on your mind.</p>
        <div className="steps">
          {STEPS.map(s => (
            <div className="step" key={s.n}>
              <div className="step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Things you can ask Nona</h2>
        <p className="lead">Spoken or typed — same AI parsing either way.</p>
        <div className="asks">
          {ASKS.map(x => (
            <div className="ask" key={x.q}>
              <div className="ask-q">{x.q}</div>
              <div className="ask-a">{x.a}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Works with</h2>
        <div className="works-with">
          <span className="chip">Gmail</span>
          <span className="chip">Outlook</span>
          <span className="chip-muted">More integrations on the roadmap</span>
        </div>
      </section>

      <section className="block">
        <h2>Built for the person holding it all together</h2>
        <p className="lead">
          Dual-income households, working parents, anyone whose day runs across five
          different inboxes and apps instead of one place — Nona is for the invisible
          coordination work that never shows up on anyone's to-do list except yours.
        </p>
      </section>

      <section className="block founder">
        <div className="founder-quote">
          <p>
            I built Nona because I was the default household coordinator — tasks, kids'
            appointments, flights, bills — scattered across email, a notes app, and my own
            memory. I wanted one place that told me what actually needed doing today,
            without me having to go looking for it.
          </p>
          <div className="founder-sig">— the founder, building Nona solo · <Link href="/about">more about Nona</Link></div>
        </div>
      </section>

      <section className="block" id="faq">
        <h2>Questions</h2>
        <div className="faq-list">
          {FAQS.map(f => <Faq key={f.q} q={f.q} a={f.a} />)}
        </div>
      </section>

      <style jsx>{`
        .hero { display: flex; align-items: center; gap: 56px; padding: 48px 0 96px; flex-wrap: wrap; }
        .hero-copy { flex: 1 1 420px; min-width: 300px; }
        .eyebrow { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--coral);
          font-weight: 600; margin-bottom: 18px; }
        .sub { font-size: 17px; line-height: 1.6; color: var(--muted); max-width: 480px; margin-bottom: 32px; }
        .cta-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 20px; }
        .status-line { font-size: 13px; color: var(--muted); }

        .mock { flex: 1 1 380px; min-width: 300px; position: relative; height: 380px; }
        .mock-brief { background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
          padding: 20px 22px; box-shadow: 0 12px 30px rgba(42,39,51,0.08); position: absolute; top: 0; left: 10%;
          width: 78%; z-index: 2; }
        .mock-brief-label { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--coral);
          font-weight: 700; margin-bottom: 10px; }
        .mock-brief-item { font-size: 14px; color: var(--ink); padding: 7px 0; border-bottom: 1px solid var(--border); }
        .mock-brief-item:last-child { border-bottom: none; }
        .mock-notes { position: absolute; bottom: 0; left: 0; right: 0; height: 210px; }
        .mock-note { position: absolute; width: 150px; border-radius: 10px; padding: 14px 16px; font-size: 13px;
          font-weight: 500; box-shadow: 0 8px 18px rgba(42,39,51,0.12); color: var(--ink); }
        .mock-note-tag { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
          color: rgba(42,39,51,0.5); margin-top: 6px; font-weight: 700; }

        .flow { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 52px; }
        .flow-pill { background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
          padding: 9px 16px; font-size: 13px; font-weight: 600; }
        .flow-arrow { color: var(--coral); font-size: 15px; }

        .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 28px; }
        .step-n { font-family: 'Instrument Serif', serif; font-size: 40px; color: var(--coral-mid); margin-bottom: 8px; }
        .step p { font-size: 14px; line-height: 1.6; color: var(--muted); }

        .asks { display: flex; flex-direction: column; gap: 16px; }
        .ask { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 22px 24px;
          display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-start; }
        .ask-q { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 18px; color: var(--ink);
          flex: 1 1 260px; }
        .ask-a { flex: 1 1 300px; font-size: 14px; line-height: 1.6; color: var(--muted); }

        .works-with { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
        .chip { background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
          padding: 10px 18px; font-size: 14px; font-weight: 700; }
        .chip-muted { font-size: 13px; color: var(--muted); font-weight: 500; }

        .founder { display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-start; }
        .founder-quote { flex: 1 1 500px; font-size: 18px; line-height: 1.7; color: var(--ink); }
        .founder-quote p { margin-bottom: 16px; }
        .founder-sig { font-size: 13px; color: var(--muted); margin-top: 8px; }
        .founder-sig :global(a) { color: var(--coral); font-weight: 600; }

        .faq-list { display: flex; flex-direction: column; }
        .faq-item { border-bottom: 1px solid var(--border); padding: 20px 0; cursor: pointer; }
        .faq-q { display: flex; align-items: center; justify-content: space-between; font-size: 16px; font-weight: 700; gap: 20px; }
        .faq-toggle { color: var(--coral); font-size: 18px; font-weight: 700; flex-shrink: 0; }
        .faq-a { font-size: 14px; line-height: 1.6; color: var(--muted); margin-top: 12px; max-width: 640px; }
      `}</style>
    </MarketingLayout>
  )
}
