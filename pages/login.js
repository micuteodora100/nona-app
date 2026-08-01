import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/router"
import Head from "next/head"
import { supabase } from "../lib/supabase"
import TurnstileWidget, { TURNSTILE_SITE_KEY } from "../components/TurnstileWidget"

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState("login") // login | signup | magic
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [configError, setConfigError] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")
  const resetCaptcha = useRef(null)

  useEffect(() => {
    if (!supabase) { setConfigError(true); return }

    // Magic links and signup confirmations land back here carrying ?code=…
    // — createBrowserClient is PKCE-only (@supabase/ssr forces flowType
    // "pkce"), so that code is exchanged for a session during the client's
    // own initialization, which both getUser() and getSession() await. The
    // exchange can only happen on a page that actually mounts the Supabase
    // client, which is why emailRedirectTo in handleLogin points here: the
    // Supabase default is the project's Site URL, and pages/index.js is the
    // marketing page that never imports lib/supabase, so a link landing
    // there left the code unspent and the person still logged out.
    // An expired or already-used link comes back as ?error=…&error_description=…
    // instead of a code. Deliberately left in the URL rather than tidied away
    // with replaceState: reactStrictMode double-mounts this effect in dev, so
    // clearing the query on the first mount left the second one with nothing
    // to read and the message never rendered at all. The URL is also what
    // makes the error survive a refresh, which is the right behaviour anyway.
    const params = new URLSearchParams(window.location.search)
    const linkError = params.get("error_description") || params.get("error")
    if (linkError) {
      setError(linkError)
      return
    }

    // getUser() validates the session against Supabase; getSession() only
    // reads the cookie and trusts it. They disagree once an account is
    // deleted or signed out everywhere — and since middleware.js validates
    // too, trusting the cookie here bounced the person /login → /app →
    // /login in a loop until the access token finally expired.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace("/app")
    })
  }, [])

  // router.query is never populated on a statically-optimized page loaded with
  // a query string, so read the URL directly for the /login?mode=signup CTA.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("mode") === "signup") setMode("signup")
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError("Please complete the verification check below.")
      return
    }
    setError(""); setMessage(""); setLoading(true)
    // Supabase ignores an undefined captchaToken, so this is a no-op until
    // CAPTCHA is switched on in Authentication → Attack Protection.
    const captcha = TURNSTILE_SITE_KEY ? { captchaToken } : {}
    // Emailed links have to come back to this page — it's the only one that
    // mounts the Supabase client and can therefore complete the PKCE code
    // exchange (see the mount effect above). This URL also has to be listed
    // under Authentication → URL Configuration → Redirect URLs in the
    // Supabase dashboard, or Supabase silently falls back to the Site URL.
    const emailRedirectTo = `${window.location.origin}/login`
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { ...captcha, emailRedirectTo } })
        if (error) throw error
        setMessage("Check your email for a login link!")
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { ...captcha, emailRedirectTo } })
        if (error) throw error
        // With email confirmation switched off in the dashboard, signUp
        // returns a live session immediately — telling her to go and confirm
        // an email that will never arrive, while she's already signed in, is
        // just wrong. Only show that message when there's genuinely no
        // session yet and a confirmation really is pending.
        if (data.session) {
          router.replace("/app")
        } else {
          setMessage("Account created! Check your email to confirm, then log in.")
          setMode("login")
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password, options: captcha })
        if (error) throw error
        router.replace("/app")
      }
    } catch (err) {
      setError(err.message)
    }
    // The token is spent either way — a successful sign-in navigates away, but
    // signup/magic-link stay on this page and would otherwise reuse a dead one.
    resetCaptcha.current?.()
    setLoading(false)
  }

  return (
    <>
      <Head>
        <title>Nona — Sign in</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Syne:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        /* Same tokens as the marketing site (components/MarketingLayout.js) so
           signing in doesn't jump from the warm light theme to the retired
           dark one. */
        :root {
          --bg: #FBF6EE; --ink: #2A2733; --coral: #FF6B4A;
          --coral-mid: rgba(255,107,74,0.35);
          --muted: rgba(42,39,51,0.55); --surface: #FFFFFF; --border: rgba(42,39,51,0.1);
        }
        html, body { height: 100%; background: var(--bg); color: var(--ink);
          font-family: 'Syne', sans-serif; -webkit-font-smoothing: antialiased; }
        .wrap { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px; }
        .logo { font-family: 'Instrument Serif', serif; font-size: 48px; color: var(--ink); margin-bottom: 40px; }
        form { width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 12px; }
        input { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          color: var(--ink); font-size: 15px; padding: 14px 16px; outline: none; font-family: 'Syne', sans-serif; width: 100%; }
        input::placeholder { color: var(--muted); }
        input:focus { border-color: var(--coral-mid); }
        .password-field { position: relative; }
        .password-field input { padding-right: 56px; }
        .password-toggle { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--muted); font-size: 12px; cursor: pointer; padding: 8px 10px; font-family: 'Syne', sans-serif; }
        .password-toggle:hover { color: var(--coral); }
        .btn-gold { background: var(--coral); color: #FFFFFF; border: none; border-radius: 12px; font-size: 15px; font-weight: 700; padding: 14px; cursor: pointer; font-family: 'Syne', sans-serif; width: 100%; }
        .btn-gold:disabled { opacity: 0.6; cursor: default; }
        .captcha { display: flex; justify-content: center; }
        .err { color: #C4462A; font-size: 13px; text-align: center; }
        .msg { color: #2E7D4F; font-size: 13px; text-align: center; }
        .divider { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; }
        .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .mode-links { display: flex; gap: 8px; justify-content: center; font-size: 12px; }
        .mode-link { color: var(--coral); cursor: pointer; background: none; border: none; font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 600; text-decoration: underline; }
      `}</style>
      <div className="wrap">
        <div className="logo">nona</div>
        {configError ? (
          <div className="err">Sign-in isn't configured on this deployment. Contact the site owner.</div>
        ) : (
        <form onSubmit={handleLogin}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required />
          {mode !== "magic" && (
            <div className="password-field">
              <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required={mode !== "magic"} />
              <button type="button" className="password-toggle" onClick={() => setShowPassword(s => !s)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          )}
          <TurnstileWidget className="captcha" onToken={setCaptchaToken} resetRef={resetCaptcha} />
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
        )}
      </div>
    </>
  )
}
