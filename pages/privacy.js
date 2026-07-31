import MarketingLayout from "../components/MarketingLayout"

export default function Privacy() {
  return (
    <MarketingLayout
      title="Privacy Policy"
      description="What Nona collects, how it's used, and your options."
    >
      <section className="block" style={{ borderTop: "none", paddingTop: "48px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "10px" }}>Privacy Policy</h1>
        <p className="lead">Last updated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.</p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>What Nona collects</h2>
        <p className="body-text">
          Your account email (via sign-in), and whatever you enter directly — tasks,
          notes, and calendar items. If you connect Gmail or Outlook, Nona requests
          read-only access to fetch and summarize your inbox.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Email data specifically</h2>
        <p className="body-text">
          Email content is read live over the provider's API for each request and is not
          stored afterward — it's processed in memory to generate summaries and briefs,
          then discarded. Nona's access is read-only: it cannot send, delete, or modify
          anything in your inbox. OAuth tokens that grant this access are stored
          server-side, encrypted, never in the browser.
        </p>

        {/* Required by Google for any app using a restricted scope (Nona uses
            gmail.readonly): the consent screen links here, and both the
            adherence statement and the Limited Use specifics below are what
            Google's reviewers check for. Keep the wording — it's quoting a
            policy commitment, not describing a feature. */}
        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Google user data</h2>
        <p className="body-text">
          Nona's use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)", fontWeight: 600 }}>
            Google API Services User Data Policy
          </a>, including its Limited Use requirements.
        </p>
        <p className="body-text">
          Concretely, if you connect a Google account Nona requests two read-only scopes:
          Gmail (<code>gmail.readonly</code>) to summarise and triage your inbox, and
          Calendar (<code>calendar.readonly</code>) to show your appointments in the week
          view. Nona cannot send, delete or change anything in either. That data is used
          only to provide those features to you: it is never sold, never used for
          advertising or profiling, never used to train generalised AI or machine-learning
          models, and no human at Nona reads it. Email and calendar text is sent to the
          Anthropic API (Claude) to produce your summaries — Anthropic processes it as a
          service provider under their API terms and does not use API inputs to train
          models. Nothing else receives it.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>How data is used</h2>
        <p className="body-text">
          Solely to run the features you use — generating your daily brief, parsing tasks,
          and triaging email. Task and email text is sent to the Anthropic API (Claude) to
          do that parsing and summarizing; Anthropic processes it under their own API terms
          and does not use API inputs to train models.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Mailing list</h2>
        <p className="body-text">
          If you sign up for product updates, your email is stored separately for that
          purpose only. You can unsubscribe at any time from the{" "}
          <a href="/unsubscribe" style={{ color: "var(--coral)", fontWeight: 600 }}>unsubscribe page</a>.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Third parties</h2>
        <p className="body-text">
          Nona runs on Vercel (hosting) and Supabase (database, authentication). Sign-in
          and email triage integrate with Google and Microsoft. None of these providers
          receive more than what's required to operate the feature in question.
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Your data, your control</h2>
        <p className="body-text">
          You can request deletion of your account data at any time via the{" "}
          <a href="/contact" style={{ color: "var(--coral)", fontWeight: 600 }}>contact page</a>.
          {/* Was "Disconnecting Gmail or Outlook revokes Nona's access immediately" —
              true for Google, which we revoke with Google itself, but not for
              Microsoft, which offers no programmatic revoke for delegated tokens
              (see revokeProviderToken in lib/tokens.js). A privacy policy that
              overstates what happens is worse than one that spells out the
              difference, and Google's reviewers read this page. */}
          {" "}Disconnecting Gmail revokes Nona's access with Google immediately. Disconnecting
          Outlook deletes Nona's stored tokens straight away, which stops all access; Microsoft
          offers no way for an app to revoke its own consent, so to clear that record on their
          side too, remove Nona at{" "}
          <a href="https://account.live.com/consent/Manage" target="_blank" rel="noopener noreferrer" style={{ color: "var(--coral)", fontWeight: 600 }}>
            account.live.com
          </a>{" "}
          (personal accounts) or myapps.microsoft.com (work or school accounts).
        </p>

        <h2 style={{ fontSize: "20px", marginTop: "24px" }}>Where things stand</h2>
        <p className="body-text">
          Nona is an actively developed MVP built by a solo founder. This policy describes
          how the product works today and will be updated as it changes — check back
          periodically if that matters to you.
        </p>
      </section>
    </MarketingLayout>
  )
}
