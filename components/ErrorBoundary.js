import { Component } from "react"

// Next.js's default production crash screen is a blank page with no detail
// ("Application error: a client-side exception has occurred") and no way to
// get the actual error on mobile where there's no console. This shows the
// real message/stack instead so a crash is at least reportable.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error("Uncaught render error:", error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100dvh", background: "#FBF6EE", color: "#2A2733", fontFamily: "monospace", padding: 24, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <div style={{ fontFamily: "sans-serif", fontWeight: 700, marginBottom: 12 }}>Something broke. Screenshot this and send it over:</div>
          <div style={{ marginBottom: 12 }}>{String(this.state.error?.message || this.state.error)}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{this.state.error?.stack}</div>
          <button
            style={{ marginTop: 20, fontFamily: "sans-serif", padding: "10px 16px", borderRadius: 8, border: "none", background: "#FF6B4A", color: "#fff", fontWeight: 600 }}
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
          >Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}
