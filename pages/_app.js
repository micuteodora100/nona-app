import { SessionProvider } from "next-auth/react"
import { Analytics } from "@vercel/analytics/react"
import ErrorBoundary from "../components/ErrorBoundary"

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
      <ErrorBoundary>
        <Component {...pageProps} />
      </ErrorBoundary>
      <Analytics />
    </SessionProvider>
  )
}
