import Head from "next/head"
import Link from "next/link"
import MailingListForm from "./MailingListForm"

export default function MarketingLayout({ title, description, children }) {
  const fullTitle = title ? `${title} — Nona` : "Nona — remembers everything so you don't have to"
  const fullDescription = description || "Emails, appointments, school messages, bookings, deadlines — one brief of what actually needs your attention."

  return (
    <>
      <Head>
        <title>{fullTitle}</title>
        <meta name="description" content={fullDescription} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={fullDescription} />
        <meta name="theme-color" content="#FBF6EE" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #FBF6EE; --ink: #2A2733; --coral: #FF6B4A;
          --coral-dim: rgba(255,107,74,0.12); --coral-mid: rgba(255,107,74,0.35);
          --muted: rgba(42,39,51,0.55); --surface: #FFFFFF; --border: rgba(42,39,51,0.1);
        }
        html, body { background: var(--bg); color: var(--ink); font-family: 'Syne', sans-serif;
          -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        a { color: inherit; text-decoration: none; }
        em { font-family: 'Instrument Serif', serif; font-style: italic; color: var(--coral); }

        .page { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
        .nav { display: flex; align-items: center; justify-content: space-between; padding: 24px 0; gap: 24px; flex-wrap: wrap; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 28px; color: var(--ink); }
        .nav-links { display: flex; gap: 28px; font-size: 14px; color: var(--muted); font-weight: 600; flex-wrap: wrap; }
        .nav-links a:hover { color: var(--coral); }
        .nav-right { display: flex; align-items: center; gap: 20px; }
        .nav-cta { background: var(--ink); color: var(--bg); font-family: 'Syne', sans-serif;
          font-weight: 600; font-size: 14px; padding: 10px 20px; border-radius: 10px; }

        section.block { padding: 72px 0; border-top: 1px solid var(--border); }
        h1 { font-family: 'Instrument Serif', serif; font-size: clamp(38px, 5vw, 58px); line-height: 1.08;
          font-weight: 400; margin-bottom: 22px; }
        h2 { font-family: 'Instrument Serif', serif; font-size: 32px; font-weight: 400; margin-bottom: 14px; }
        h3 { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
        .lead { color: var(--muted); font-size: 15px; max-width: 620px; margin-bottom: 44px; line-height: 1.6; }
        p.body-text { font-size: 15px; line-height: 1.7; color: var(--muted); max-width: 640px; margin-bottom: 18px; }

        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 20px; }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 24px; }
        .card h3 { font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; margin-bottom: 10px; }
        .card p { font-size: 14px; line-height: 1.6; color: var(--muted); }

        .btn-primary { background: var(--coral); color: #FFFFFF; font-family: 'Syne', sans-serif; font-weight: 700;
          font-size: 15px; padding: 15px 28px; border-radius: 12px; display: inline-block; border: none; cursor: pointer; }

        footer.site-footer { border-top: 1px solid var(--border); padding: 56px 0 32px; }
        .foot-top { display: flex; gap: 48px; flex-wrap: wrap; justify-content: space-between; padding-bottom: 40px; }
        .foot-brand { flex: 1 1 280px; max-width: 340px; }
        .foot-logo { font-family: 'Instrument Serif', serif; font-size: 22px; margin-bottom: 10px; }
        .foot-tag { font-size: 13px; color: var(--muted); margin-bottom: 14px; line-height: 1.5; }
        .foot-cols { display: flex; gap: 48px; flex-wrap: wrap; }
        .foot-col { display: flex; flex-direction: column; gap: 10px; min-width: 120px; }
        .foot-col-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--ink); margin-bottom: 4px; }
        .foot-col a { font-size: 13px; color: var(--muted); }
        .foot-col a:hover { color: var(--coral); }
        .foot-bottom { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
          padding-top: 24px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
        .foot-bottom a:hover { color: var(--coral); }
      `}</style>

      <div className="page">
        <nav className="nav">
          <Link className="logo" href="/">nona</Link>
          <div className="nav-links">
            <Link href="/#what-it-does">What it does</Link>
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/about">About</Link>
          </div>
          <div className="nav-right">
            <Link className="nav-cta" href="/login">Sign in</Link>
          </div>
        </nav>

        {children}

        <footer className="site-footer">
          <div className="foot-top">
            <div className="foot-brand">
              <div className="foot-logo">nona</div>
              <p className="foot-tag">Get product updates by email — no spam, unsubscribe anytime.</p>
              <MailingListForm compact />
            </div>
            <div className="foot-cols">
              <div className="foot-col">
                <div className="foot-col-title">Product</div>
                <Link href="/#what-it-does">What it does</Link>
                <Link href="/#how-it-works">How it works</Link>
              </div>
              <div className="foot-col">
                <div className="foot-col-title">Company</div>
                <Link href="/about">About</Link>
                <Link href="/contact">Contact</Link>
              </div>
              <div className="foot-col">
                <div className="foot-col-title">Legal</div>
                <Link href="/privacy">Privacy Policy</Link>
                <Link href="/terms">Terms of Service</Link>
                <Link href="/unsubscribe">Unsubscribe</Link>
              </div>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© {new Date().getFullYear()} Nona. All rights reserved.</span>
            <Link href="/login">Sign in</Link>
          </div>
        </footer>
      </div>
    </>
  )
}
