import { useState, useRef } from "react"
import TurnstileWidget, { TURNSTILE_SITE_KEY } from "./TurnstileWidget"

export default function MailingListForm({ compact = false }) {
  const [email, setEmail] = useState("")
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
      const res = await fetch("/api/mailing-list/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company, captchaToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Something went wrong")
      setStatus("done")
    } catch (err) {
      setError(err.message)
      setStatus("error")
      // The token is spent whether or not the request succeeded, so a retry
      // needs a fresh one.
      resetCaptcha.current?.()
    }
  }

  if (status === "done") {
    return <p className={`mlf-done ${compact ? "mlf-compact" : ""}`}>You're on the list.</p>
  }

  return (
    <form className={`mlf ${compact ? "mlf-compact" : ""}`} onSubmit={submit}>
      <input
        type="text"
        name="company"
        value={company}
        onChange={e => setCompany(e.target.value)}
        className="mlf-hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <input
        type="email"
        required
        placeholder="you@email.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="mlf-input"
      />
      <button type="submit" className="mlf-btn" disabled={status === "loading"}>
        {status === "loading" ? "…" : "Subscribe"}
      </button>
      <TurnstileWidget className="mlf-captcha" onToken={setCaptchaToken} resetRef={resetCaptcha} />
      {status === "error" && <span className="mlf-error">{error}</span>}

      <style jsx>{`
        .mlf { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .mlf-hp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
        .mlf-input { flex: 1 1 200px; background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; padding: 10px 14px; font-family: 'Syne', sans-serif; font-size: 14px; color: var(--ink); }
        .mlf-input:focus { outline: none; border-color: var(--coral-mid); }
        .mlf-btn { background: var(--ink); color: var(--bg); font-family: 'Syne', sans-serif; font-weight: 700;
          font-size: 14px; padding: 10px 18px; border-radius: 10px; border: none; cursor: pointer; white-space: nowrap; }
        .mlf-btn:disabled { opacity: 0.6; cursor: default; }
        /* :global() because the widget's div is rendered by a child component,
           so styled-jsx's scoping class is never applied to it. */
        .mlf :global(.mlf-captcha) { flex-basis: 100%; }
        .mlf-error { flex-basis: 100%; font-size: 12px; color: var(--coral); }
        .mlf-done { font-size: 14px; color: var(--muted); font-weight: 600; }
        .mlf-compact .mlf-input { flex: 1 1 160px; padding: 8px 12px; font-size: 13px; }
        .mlf-compact .mlf-btn { padding: 8px 14px; font-size: 13px; }
      `}</style>
    </form>
  )
}
