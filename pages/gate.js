import { useState } from "react"
import { useRouter } from "next/router"
import Head from "next/head"

export default function Gate() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const r = await fetch("/api/auth-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (r.ok) {
        router.push("/")
      } else {
        setError("Wrong password")
      }
    } catch {
      setError("Something went wrong")
    }
    setLoading(false)
  }

  return (
    <>
      <Head>
        <title>Nona</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; background: #0D0C0A; }
        .wrap { min-height: 100dvh; display: flex; flex-direction: column;
          align-items: center; justify-content: center; padding: 32px; font-family: 'Syne', sans-serif; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 48px; color: #E8C87A; margin-bottom: 8px; }
        .tag { font-size: 12px; color: rgba(245,240,232,0.45); letter-spacing: 0.08em;
          text-transform: uppercase; margin-bottom: 40px; }
        form { width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 12px; }
        input { background: rgba(255,255,255,0.04); border: 1px solid rgba(232,200,122,0.12);
          border-radius: 12px; color: #F5F0E8; font-size: 16px; padding: 14px 16px; outline: none;
          font-family: 'Syne', sans-serif; text-align: center; letter-spacing: 0.1em; }
        input:focus { border-color: rgba(232,200,122,0.4); }
        button { background: #E8C87A; color: #0D0C0A; border: none; border-radius: 12px;
          font-size: 15px; font-weight: 600; padding: 14px; cursor: pointer; font-family: 'Syne', sans-serif; }
        button:active { opacity: 0.8; }
        button:disabled { opacity: 0.5; }
        .err { color: #e87a7a; font-size: 13px; text-align: center; }
      `}</style>
      <div className="wrap">
        <div className="logo">nona</div>
        <div className="tag">private · enter password</div>
        <form onSubmit={submit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
          />
          {error && <div className="err">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? "Checking…" : "Unlock"}</button>
        </form>
      </div>
    </>
  )
}
