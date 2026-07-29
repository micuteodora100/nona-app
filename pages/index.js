import Link from "next/link"
import { track } from "@vercel/analytics"
import MarketingLayout from "../components/MarketingLayout"

// Illustrative example tasks for the hero mockup — deliberately generic,
// not real household data, since this page is public.
const MOCK_TASKS = [
  { text: "Pay daycare invoice", tag: "Bills & money", color: "#F6D1C9", rot: -2 },
  { text: "Book dentist for Mia", tag: "Health", color: "#CDEDE6", rot: 1.5 },
  { text: "Pack for weekend trip", tag: "Family", color: "#E3D6F0", rot: -1 },
  { text: "Reply to school re: trip", tag: "Applications", color: "#CFE0F3", rot: 2 },
]

const CATEGORIES = ["Email", "Calendar", "Tasks", "Bookings"]

const EXAMPLES = [
  {
    before: "School: reminder that children need a red T-shirt for Friday's summer show.",
    after: "🔴 Buy/pack red T-shirt — by Thursday",
  },
  {
    before: "Airline: online check-in opens 30 July.",
    after: "✈️ Check in tomorrow",
  },
  {
    before: "Daycare: a 900-word newsletter, buried somewhere in there.",
    after: "📸 Photo day Tuesday — bring child before 9:00",
  },
]

const STEPS = [
  { n: "01", title: "Connect", body: "Link Gmail and/or Outlook, read-only. A couple of clicks, once." },
  { n: "02", title: "Nona finds", body: "Reads what comes in and works out what actually needs attention — no manual sorting, nothing for you to check." },
  { n: "03", title: "Nona reminds", body: "One brief every morning, plus a push notification when something's genuinely time-sensitive." },
]

function trackClick(name, location) {
  try { track(name, { location }) } catch {}
}

export default function Landing() {
  return (
    <MarketingLayout>
      <div className="hero">
        <div className="hero-copy">
          <h1>Nona remembers everything so you <em>don't have to</em>.</h1>
          <p className="sub">
            Emails. Appointments. School messages. Bookings. Deadlines. One brief of
            what actually needs your attention.
          </p>
          <div className="cta-row">
            <Link
              className="btn-primary"
              href="/login?mode=signup"
              onClick={() => trackClick("try_nona_click", "hero")}
            >
              Try Nona
            </Link>
          </div>
          <div className="hero-note">
            Read-only — Nona can't send, delete, or store your email.{" "}
            <Link href="/privacy">How Nona handles your data →</Link>
          </div>
          <div className="hero-meta">Early access.</div>
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
        <h2>Your life is already organized. Just badly.</h2>
        <p className="lead">
          Scattered across five different inboxes and apps instead of one place.
        </p>
        <div className="flow">
          {CATEGORIES.map(c => (
            <span className="flow-pill" key={c}>{c}</span>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Nona finds what needs doing</h2>
        <p className="lead">You shouldn't have to ask. It should just be there.</p>
        <div className="examples">
          {EXAMPLES.map(x => (
            <div className="example" key={x.before}>
              <div className="example-before">
                <span className="example-label">Comes in as</span>
                {x.before}
              </div>
              <span className="example-arrow">→</span>
              <div className="example-after">
                <span className="example-label">Nona notices</span>
                {x.after}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Every morning, one brief</h2>
        <p className="lead">Pulled from your inbox, your tasks, and your calendar — before you've opened any of them.</p>
        <div className="brief-showcase">
          <div className="brief-card">
            <div className="brief-card-label">Today's brief</div>
            <div className="brief-card-item">Daycare invoice due Friday</div>
            <div className="brief-card-item">Flight to Nice — check in at 6pm</div>
            <div className="brief-card-item">School: red T-shirt needed by Thursday</div>
            <div className="brief-card-item">2 unread emails need a reply</div>
          </div>
        </div>
      </section>

      <section className="block" id="how-it-works">
        <h2>How it works</h2>
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
        <h2>Privacy</h2>
        <p className="body-text">
          Nona reads your inbox live over a read-only connection — it can't send, delete,
          or modify anything. Email content isn't stored: it's processed in memory to
          build your brief, then discarded.
        </p>
        <p className="body-text">
          <Link href="/privacy" style={{ color: "var(--coral)", fontWeight: 600 }}>Read the full privacy policy →</Link>
        </p>
      </section>

      <section className="block founder">
        <div className="founder-quote">
          <p className="founder-intro">I built this because I had this problem too.</p>
          <p>
            I was the default household coordinator — tasks, kids' appointments, flights,
            bills — scattered across email, a notes app, and my own memory. I wanted one
            place that told me what actually needed doing today, without me having to go
            looking for it.
          </p>
          <div className="founder-sig">— the founder, building Nona solo · <Link href="/about">more about Nona</Link></div>
        </div>
      </section>

      <section className="block final-cta">
        <h2>Try Nona</h2>
        <p className="lead">Free during early access.</p>
        <Link
          className="btn-primary"
          href="/login?mode=signup"
          onClick={() => trackClick("try_nona_click", "final_cta")}
        >
          Try Nona
        </Link>
      </section>

      <style jsx>{`
        .hero { display: flex; align-items: center; gap: 56px; padding: 48px 0 96px; flex-wrap: wrap; }
        .hero-copy { flex: 1 1 420px; min-width: 300px; }
        .sub { font-size: 17px; line-height: 1.6; color: var(--muted); max-width: 480px; margin-bottom: 32px; }
        .cta-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 16px; }
        .hero-note { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
        .hero-note :global(a) { color: var(--coral); font-weight: 600; }
        .hero-meta { font-size: 12px; color: var(--muted); opacity: 0.8; }

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

        .flow { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .flow-pill { background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
          padding: 9px 16px; font-size: 13px; font-weight: 600; }

        .examples { display: flex; flex-direction: column; gap: 16px; }
        .example { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 22px 24px;
          display: flex; gap: 20px; flex-wrap: wrap; align-items: center; }
        .example-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--muted); font-weight: 700; margin-bottom: 6px; }
        .example-before { flex: 1 1 280px; font-size: 14px; line-height: 1.6; color: var(--muted); }
        .example-after { flex: 1 1 280px; font-size: 17px; font-weight: 700; color: var(--ink); }
        .example-arrow { color: var(--coral); font-size: 20px; flex: 0 0 auto; }

        .brief-showcase { display: flex; justify-content: center; }
        .brief-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
          padding: 28px 32px; box-shadow: 0 12px 30px rgba(42,39,51,0.08); max-width: 420px; width: 100%; }
        .brief-card-label { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--coral);
          font-weight: 700; margin-bottom: 14px; }
        .brief-card-item { font-size: 15px; color: var(--ink); padding: 10px 0; border-bottom: 1px solid var(--border); }
        .brief-card-item:last-child { border-bottom: none; }

        .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 28px; }
        .step-n { font-family: 'Instrument Serif', serif; font-size: 40px; color: var(--coral-mid); margin-bottom: 8px; }
        .step p { font-size: 14px; line-height: 1.6; color: var(--muted); }

        .founder { display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-start; }
        .founder-quote { flex: 1 1 500px; font-size: 18px; line-height: 1.7; color: var(--ink); }
        .founder-intro { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 22px; color: var(--coral); margin-bottom: 18px; }
        .founder-quote p { margin-bottom: 16px; }
        .founder-sig { font-size: 13px; color: var(--muted); margin-top: 8px; }
        .founder-sig :global(a) { color: var(--coral); font-weight: 600; }

        .final-cta { text-align: center; display: flex; flex-direction: column; align-items: center; }
      `}</style>
    </MarketingLayout>
  )
}
