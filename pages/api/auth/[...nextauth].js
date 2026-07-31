import NextAuth from "next-auth"
import { getToken } from "next-auth/jwt"
import GoogleProvider from "next-auth/providers/google"
import { persistProviderTokens } from "../../../lib/tokens"
import { getSupabaseUserReadOnly } from "../../../lib/supabase-auth"

// Microsoft personal accounts via OAuth 2.0 + Microsoft Graph API
// Uses /consumers endpoint for personal @outlook.com/@hotmail.com accounts
const MicrosoftPersonalProvider = {
  id: "microsoft",
  name: "Microsoft",
  type: "oauth",
  wellKnown: "https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration",
  authorization: {
    params: {
      scope: "openid profile email offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Notes.Read https://graph.microsoft.com/Calendars.Read",
    },
  },
  idToken: true,
  checks: ["pkce", "state"],
  profile(profile) {
    return { id: profile.sub, name: profile.name, email: profile.email }
  },
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
}

// authOptions has to be a function of `req` (not a static object) because the
// jwt() callback below needs it — see the comment inside jwt() for why.
export function getAuthOptions(req) {
  return {
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authorization: {
          params: {
            scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
            access_type: "offline",
            prompt: "consent",
          },
        },
      }),
      MicrosoftPersonalProvider,
    ],
    callbacks: {
      async jwt({ token, account, profile }) {
        if (account) {
          // NextAuth's own OAuth callback route (node_modules/next-auth/core/routes/callback.js)
          // always builds `token` from scratch as {name, email, picture, sub}
          // for every fresh sign-in — it never decodes the browser's existing
          // session cookie first. That means token.providers started empty
          // on every single sign-in, so connecting a second provider always
          // wiped out whatever was connected before — 100% of the time, not
          // an occasional glitch. We have to manually decode the incoming
          // request's current session cookie here and seed token.providers
          // from it before adding the provider that just finished signing in.
          try {
            const existing = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
            if (existing?.providers) token.providers = { ...existing.providers }
          } catch (err) {
            console.error("Failed to read existing session for provider merge:", err.message)
          }

          if (!token.providers) token.providers = {}
          const providerEmail = profile?.email || token.email
          token.providers[account.provider] = {
            connected: true,
            email: providerEmail,
          }

          try {
            // Tokens are stored against the Supabase Auth identity someone is
            // actually logged into the app as — never against the OAuth
            // provider's own email. Otherwise two different app accounts that
            // happen to connect the same-looking data would collide, and one
            // person's tasks/tokens could end up keyed by whichever email
            // Google/Microsoft last handed back. See ROADMAP.md's multi-user
            // identity migration for the full story.
            const supabaseUser = await getSupabaseUserReadOnly(req)
            if (!supabaseUser) {
              console.error("Cannot persist provider tokens: no Supabase Auth session on this request — connect Gmail/Outlook from inside the logged-in app, not standalone.")
            } else {
              await persistProviderTokens(supabaseUser.id, account.provider, {
                accessToken: account.access_token,
                refreshToken: account.refresh_token,
                expiresAt: account.expires_at,
                accountEmail: providerEmail,
              })
            }
          } catch (err) {
            // Never break sign-in over token persistence — log and move on
            console.error("persistProviderTokens failed:", err.message)
          }
        }
        return token
      },
      async session({ session, token }) {
        session.providers = token.providers || {}
        const providerIds = Object.keys(session.providers)
        const last = providerIds[providerIds.length - 1]
        if (last) session.provider = last
        session.error = token.error
        return session
      },
    },
    pages: {
      signIn: "/app",
      // Without this, every OAuth failure lands on NextAuth's built-in error
      // page, which for all the codes that matter here (OAuthCallback,
      // Callback, …) renders nothing but the word "Error" and the hostname —
      // no cause, no next step, nothing to relay. See pages/auth-error.js.
      error: "/auth-error",
    },
    // NextAuth's default logger prints the whole error object, which on Vercel
    // is easy to miss and awkward to search. These two lines are the ones worth
    // grepping when a connection fails: the code (OAUTH_CALLBACK_ERROR,
    // OAUTH_CALLBACK_HANDLER_ERROR, …), the provider, and the underlying
    // message — e.g. "State cookie was missing." (the flow started on a
    // different host or in an in-app browser) vs a token-exchange rejection
    // from Google/Microsoft. Only the message is logged, never tokens or the
    // authorization code.
    logger: {
      error(code, metadata) {
        const err = metadata?.error || metadata
        const provider = metadata?.providerId || metadata?.provider || "unknown"
        console.error(`[auth] ${code} provider=${provider}: ${err?.message || String(err)}`)
        // The real reason is often one level down (openid-client wraps the
        // provider's own error), and it's the part that actually identifies
        // the failure.
        if (err?.cause?.message) console.error(`[auth] ${code} cause: ${err.cause.message}`)
      },
      warn(code) {
        console.warn(`[auth] warning: ${code}`)
      },
      debug() {},
    },
    secret: process.env.NEXTAUTH_SECRET,
  }
}

export default async function auth(req, res) {
  return NextAuth(req, res, getAuthOptions(req))
}
