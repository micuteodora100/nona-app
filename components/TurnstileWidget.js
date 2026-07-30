import { useEffect, useRef } from "react"

// Cloudflare Turnstile, shared by the login page, the contact form and the
// mailing-list form.
//
// Deliberately optional: when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset this
// renders nothing and callers send no token, so every form behaves exactly as
// it did before. That lets the code ship ahead of the dashboard config —
// important because enabling CAPTCHA in Supabase rejects every auth request
// that arrives without a token, so the deploy has to come first.
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ""

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

export default function TurnstileWidget({ onToken, theme = "light", resetRef, className = "" }) {
  const boxRef = useRef(null)
  const widgetIdRef = useRef(null)
  // Kept in a ref so the mount effect never needs onToken in its dep array —
  // callers usually pass an inline arrow, which would otherwise re-run the
  // effect on every render and re-render the widget.
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false

    function render() {
      if (cancelled || !window.turnstile || !boxRef.current) return
      if (widgetIdRef.current !== null) return
      widgetIdRef.current = window.turnstile.render(boxRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme,
        callback: token => onTokenRef.current?.(token),
        "expired-callback": () => onTokenRef.current?.(""),
        "error-callback": () => onTokenRef.current?.(""),
      })
    }

    // Explicit rendering rather than Turnstile's auto-scan, so the widget can
    // be reset by id. Tokens are single-use: a form that submits, fails
    // validation and lets the user retry with the spent token fails on the
    // CAPTCHA rather than the real input, which reads as "it just stopped
    // working" to the person filling it in.
    if (window.turnstile) {
      render()
    } else {
      const existing = document.querySelector("script[data-turnstile]")
      if (existing) {
        existing.addEventListener("load", render)
        // The script may already have finished loading for a previously
        // mounted widget, in which case no further load event is coming.
        if (window.turnstile) render()
        return () => { cancelled = true; existing.removeEventListener("load", render) }
      }
      const script = document.createElement("script")
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      script.dataset.turnstile = "1"
      script.onload = render
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [theme])

  useEffect(() => {
    if (!resetRef) return
    resetRef.current = () => {
      onTokenRef.current?.("")
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
    }
    return () => { resetRef.current = null }
  }, [resetRef])

  if (!TURNSTILE_SITE_KEY) return null
  return <div className={className} ref={boxRef} style={{ minHeight: 65 }} />
}
