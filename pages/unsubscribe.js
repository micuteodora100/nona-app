import { useState } from "react"
import MarketingLayout from "../components/MarketingLayout"

export default function Unsubscribe() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState("idle") // idle | loading | done | error
  const [error, setError] = useState("")

  async function submit(e) {
    e.preventDefault()
    setStatus("loading")
    setError("")
    try {
      const res = await fetch("/api/mailing-list/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Something went wrong")
      setStatus("done")
    } catch (err) {
      setError(err.message)
      setStatus("error")
    }
  }

  return (
    <MarketingLayout
      title="Unsubscribe"
      description="Unsubscribe from Nona product updates."
    >
      <section className="block" style={{ borderTop: "none", paddingTop: "48px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "10px" }}>Unsubscribe</h1>
        <p className="lead">Enter the email you signed up with to stop receiving product updates.</p>

        {status === "done" ? (
          <p className="body-text" style={{ fontWeight: 600, color: "var(--ink)" }}>
            You're unsubscribed. You can resubscribe any time from the homepage footer.
          </p>
        ) : (
          <form onSubmit={submit} className="unsub-form">
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@email.com"
            />
            <button type="submit" className="btn-primary" disabled={status === "loading"}>
              {status === "loading" ? "…" : "Unsubscribe"}
            </button>
          </form>
        )}
        {status === "error" && <p className="form-error">{error}</p>}
      </section>

      <style jsx>{`
        .unsub-form { display: flex; gap: 10px; flex-wrap: wrap; max-width: 440px; }
        .unsub-form input { flex: 1 1 220px; font-family: 'Syne', sans-serif; font-size: 14px; color: var(--ink);
          background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
        .unsub-form input:focus { outline: none; border-color: var(--coral-mid); }
        .form-error { font-size: 13px; color: var(--coral); margin-top: 10px; }
      `}</style>
    </MarketingLayout>
  )
}
