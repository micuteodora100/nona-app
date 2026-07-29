import MarketingLayout from "../components/MarketingLayout"

export default function About() {
  return (
    <MarketingLayout
      title="About"
      description="Why Nona exists and where it's headed."
    >
      <section className="block" style={{ borderTop: "none", paddingTop: "48px" }}>
        <h1 style={{ fontSize: "44px", marginBottom: "22px" }}>About Nona</h1>
        <p className="body-text">
          Nona is built by one person, solo, to solve a problem that didn't have a good
          tool: the invisible coordination work of running a household — tasks, kids'
          appointments, flights, bills — scattered across email, a notes app, and memory.
        </p>
        <p className="body-text">
          The goal isn't another inbox or another to-do app. It's one daily view that tells
          you what actually needs doing today, pulled automatically from your inbox, tasks,
          and calendar — so you don't have to go looking for it.
        </p>
        <p className="body-text">
          Nona is in early access, built and run by one person. The core flows — daily
          brief, tasks, calendar, email triage — work end-to-end today, with multi-user
          support in place. More integrations are on the roadmap.
        </p>
      </section>

      <section className="block">
        <h2>Built with</h2>
        <p className="lead">Next.js, Supabase, the Anthropic API (Claude), and deployed on Vercel.</p>
      </section>

      <section className="block">
        <h2>Questions or feedback?</h2>
        <p className="lead">
          Get in touch on the <a href="/contact" style={{ color: "var(--coral)", fontWeight: 600 }}>contact page</a>.
        </p>
      </section>
    </MarketingLayout>
  )
}
