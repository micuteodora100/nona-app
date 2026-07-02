import { useState, useEffect } from "react"
import { useRouter } from "next/router"
import Head from "next/head"
import { supabase } from "../lib/supabase"

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState("login") // login | signup | magic
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // If Supabase not configured, fall back to password gate
    if (!supabase) { router.push("/gate"); return }

    // Check if already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push("/")
    })
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError(""); setMessage(""); setLoading(true)
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email })
        if (error) throw error
        setMessage("Check your email for a login link!")
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage("Account created! Check your email to confirm, then log in.")
        setMode("login")
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push("/")
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <>
      <Head>
        <title>Nona — Sign in</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;500;600&display=swap" rel="stylesheet" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; background: #0D0C0A; font-family: 'Syne', sans-serif; }
        .wrap { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 48px; color: #E8C87A; margin-bottom: 6px; }
        .tag { font-size: 12px; color: rgba(245,240,232,0.45); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 40px; }
        form { width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 12px; }
        input { background: rgba(255,255,255,0.04); border: 1px solid rgba(232,200,122,0.12); border-radius: 12px; color: #F5F0E8; font-size: 15px; padding: 14px 16px; outline: none; font-family: 'Syne', sans-serif; width: 100%; }
        input:focus { border-color: rgba(232,200,122,0.4); }
        .btn-gold { background: #E8C87A; color: #0D0C0A; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; padding: 14px; cursor: pointer; font-family: 'Syne', sans-serif; width: 100%; }
        .btn-ghost { background: transparent; border: 1px solid rgba(232,200,122,0.12); border-radius: 12px; color: rgba(245,240,232,0.5); font-size: 13px; padding: 11px; cursor: pointer; font-family: 'Syne', sans-serif; width: 100%; }
        .err { color: #e87a7a; font-size: 13px; text-align: center; }
        .msg { color: #7CCA7C; font-size: 13px; text-align: center; }
        .divider { display: flex; align-items: center; gap: 10px; color: rgba(245,240,232,0.3); font-size: 12px; }
        .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: rgba(232,200,122,0.1); }
        .mode-links { display: flex; gap: 8px; justify-content: center; font-size: 12px; }
        .mode-link { color: rgba(232,200,122,0.7); cursor: pointer; background: none; border: none; font-family: 'Syne', sans-serif; font-size: 12px; text-decoration: underline; }
      `}</style>
      <div className="wrap">
        <div className="logo">nona</div>
        <div className="tag">your personal AI</div>
        <form onSubmit={handleLogin}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required />
          {mode !== "magic" && (
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required={mode !== "magic"} />
          )}
          {error && <div className="err">{error}</div>}
          {message && <div className="msg">{message}</div>}
          <button type="submit" className="btn-gold" disabled={loading}>
            {loading ? "…" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send magic link"}
          </button>
          <div className="divider">or</div>
          <div className="mode-links">
            {mode !== "login" && <button type="button" className="mode-link" onClick={() => { setMode("login"); setError(""); setMessage("") }}>Sign in</button>}
            {mode !== "signup" && <button type="button" className="mode-link" onClick={() => { setMode("signup"); setError(""); setMessage("") }}>Create account</button>}
            {mode !== "magic" && <button type="button" className="mode-link" onClick={() => { setMode("magic"); setError(""); setMessage("") }}>Magic link</button>}
          </div>
        </form>
      </div>
    </>
  )
}
