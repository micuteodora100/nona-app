import { useState, useRef } from "react"
import MarketingLayout from "../components/MarketingLayout"
import TurnstileWidget, { TURNSTILE_SITE_KEY } from "../components/TurnstileWidget"

export default function Contact() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState("")
  const [company, setCompany] = useState("") // honeypot
  const [status, setStatus] = useState("idle") // idle | loading | done | error
  const [error, setError] = useState("")
  const [captchaToken, setCaptchaToken] = useState("")
  const resetCaptcha = useRef(null)

  async function submit(e) {
    e.preventDefault()
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError("Please complete the verification check")
      setStatus("error")
      return
    }
    setStatus("loading")
    setError("")
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message, company, captchaToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Something went wrong")
      setStatus("done")
    } catch (err) {
      setError(err.message)
      setStatus("error")
      // Single-use token — a retry needs a fresh one.
      resetCaptcha.current?.()
    }
  }

  return (
    <MarketingLayout
      title="Contact"
      description="Get in touch about Nona."
    >
      <section className="block" style={{ borderTop: "none", paddingTop: "48px" }}>
        <h1 style={{ fontSize: "40px", marginBottom: "10px" }}>Contact</h1>
        <p className="lead">Questions, feedback, or a data request — send a message and it goes straight to the founder.</p>

        {status === "done" ? (
          <p className="body-text" style={{ fontWeight: 600, color: "var(--ink)" }}>
            Thanks — your message is in. You'll hear back by email if a reply is needed.
          </p>
        ) : (
          <form onSubmit={submit} className="contact-form">
            <input
              type="text"
              name="company"
              value={company}
              onChange={e => setCompany(e.target.value)}
              className="hp"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />
            <label className="field">
              <span>Your email</span>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@email.com"
              />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea
                required
                rows={6}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="What's on your mind?"
              />
            </label>
            <TurnstileWidget onToken={setCaptchaToken} resetRef={resetCaptcha} />
            <button type="submit" className="btn-primary" disabled={status === "loading"}>
              {status === "loading" ? "Sending…" : "Send message"}
            </button>
            {status === "error" && <p className="form-error">{error}</p>}
          </form>
        )}
      </section>

      <style jsx>{`
        .contact-form { display: flex; flex-direction: column; gap: 18px; max-width: 480px; }
        .hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
        .field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ink); }
        .field input, .field textarea { font-family: 'Syne', sans-serif; font-size: 14px; color: var(--ink);
          background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
          font-weight: 400; resize: vertical; }
        .field input:focus, .field textarea:focus { outline: none; border-color: var(--coral-mid); }
        .form-error { font-size: 13px; color: var(--coral); }
      `}</style>
    </MarketingLayout>
  )
}
