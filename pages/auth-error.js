import Link from "next/link"
import MarketingLayout from "../components/MarketingLayout"

// Replaces NextAuth's built-in error page (a bare card reading "Error" and the
// site's hostname — see node_modules/next-auth/core/pages/error.js, whose
// `default` case is what every OAuth failure except AccessDenied/Verification/
// configuration falls through to). That page names neither what failed nor what
// to do about it, which is exactly what happened 31 Jul 2026 when someone tried
// to connect their mailbox and all we had to go on was a screenshot of the word
// "Error". Wired up via `pages.error` in pages/api/auth/[...nextauth].js.
//
// The point of this page is that a failed connection describes itself: the
// person gets a real next step, and the raw code stays on screen so it can be
// relayed (or matched against the server log line the same failure writes).
const EXPLANATIONS = {
  oauthcallback: {
    heading: "Couldn't finish connecting",
    what: "Your mailbox sent Nona back, but the last step didn't complete.",
    fixes: [
      "Open Nona directly in Safari or Chrome, not inside another app's browser (a link opened from WhatsApp, Instagram or Messenger runs in its own mini-browser that loses the connection halfway through).",
      "Start from the address Nona normally lives at, and don't switch browsers or tabs partway through the connect flow.",
      "If your browser is set to block all cookies, allow them for this site and try once more.",
    ],
  },
  callback: {
    heading: "Couldn't finish connecting",
    what: "Your mailbox approved the connection, but Nona hit an error saving it.",
    fixes: [
      "Try connecting once more — this one is usually temporary.",
      "If it keeps happening, send this page's error code over so it can be checked against the server logs.",
    ],
  },
  accessdenied: {
    heading: "Permission wasn't granted",
    what: "The connection was declined before Nona could read anything.",
    fixes: [
      "If you cancelled or unticked a permission on the Google/Microsoft screen, try again and accept the read-only access it asks for.",
      "If Google said the app isn't verified for your account, the account needs adding to Nona's approved testers first — that's on Nona's side, not yours.",
      "If it's a work or school mailbox, its IT admin may block third-party apps entirely.",
    ],
  },
  oauthaccountnotlinked: {
    heading: "That account is linked elsewhere",
    what: "This mailbox is already connected to a different Nona account.",
    fixes: [
      "Sign in as the Nona account that already has it connected, or disconnect it there first (Settings → connected accounts).",
    ],
  },
  oauthcreateaccount: {
    heading: "Couldn't set up the connection",
    what: "Nona couldn't create the record for this mailbox.",
    fixes: ["Try again in a moment — if it persists, send the error code over."],
  },
  configuration: {
    heading: "Something's misconfigured on our side",
    what: "This isn't anything you did — Nona's own sign-in setup is at fault.",
    fixes: ["Nothing to try here; the error code below is what's needed to fix it."],
  },
  verification: {
    heading: "That link has expired",
    what: "The sign-in link was already used, or it's too old.",
    fixes: ["Head back to Nona and start again to get a fresh one."],
  },
  default: {
    heading: "Couldn't finish connecting",
    what: "Something went wrong partway through connecting your mailbox.",
    fixes: [
      "Try again from Nona, in Safari or Chrome directly rather than inside another app's browser.",
      "If it keeps failing, send the error code below over so it can be traced.",
    ],
  },
}

// Read server-side, not from useRouter: on a statically-optimized page the
// query string isn't available for the first render, so the page would paint
// the generic fallback (and "No error code was passed back") before correcting
// itself on hydration — the opposite of the point of this page.
export function getServerSideProps({ query }) {
  const raw = Array.isArray(query.error) ? query.error[0] : query.error
  // Capped and passed through as-is: it lands in the page as text only, and
  // anything unrecognised falls back to the generic explanation below.
  return { props: { code: typeof raw === "string" ? raw.trim().slice(0, 60) : "" } }
}

export default function AuthError({ code }) {
  const info = EXPLANATIONS[code.toLowerCase()] || EXPLANATIONS.default

  return (
    <MarketingLayout title="Connection problem" description="Something went wrong connecting a mailbox to Nona.">
      <section className="block" style={{ borderTop: "none", paddingTop: "48px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "10px" }}>{info.heading}</h1>
        <p className="lead" style={{ marginBottom: "28px" }}>{info.what}</p>

        <div className="card" style={{ maxWidth: 620, marginBottom: 28 }}>
          <h3>What usually fixes it</h3>
          <ul className="fix-list">
            {info.fixes.map((fix, i) => <li key={i}>{fix}</li>)}
          </ul>
        </div>

        <Link href="/app" className="btn-primary">Back to Nona — try again</Link>

        <p className="code-line">
          {code ? <>Error code: <code>{code}</code></> : "No error code was passed back."}
        </p>
        <p className="body-text" style={{ fontSize: 13 }}>
          Still stuck? <Link href="/contact" style={{ color: "var(--coral)", fontWeight: 600 }}>Send us this code</Link> and
          we'll trace it — nothing from your mailbox is ever read until a connection actually succeeds.
        </p>
      </section>

      <style jsx>{`
        .fix-list { margin: 0; padding-left: 20px; }
        .fix-list li { font-size: 14px; line-height: 1.6; color: var(--muted); margin-bottom: 10px; }
        .fix-list li:last-child { margin-bottom: 0; }
        .code-line { font-size: 13px; color: var(--muted); margin: 28px 0 10px; }
        .code-line code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;
          background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 2px 7px; color: var(--ink); }
      `}</style>
    </MarketingLayout>
  )
}
