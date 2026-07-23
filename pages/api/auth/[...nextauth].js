import NextAuth from "next-auth"
import { getToken } from "next-auth/jwt"
import GoogleProvider from "next-auth/providers/google"
import { persistProviderTokens } from "../../../lib/tokens"

// Microsoft personal accounts via OAuth 2.0 + Microsoft Graph API
// Uses /consumers endpoint for personal @outlook.com/@hotmail.com accounts
const MicrosoftPersonalProvider = {
  id: "microsoft",
  name: "Microsoft",
  type: "oauth",
  wellKnown: "https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration",
  authorization: {
    params: {
      scope: "openid profile email offline_access https://graph.microsoft.com/Mail.Read",
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
            scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
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
            await persistProviderTokens(providerEmail, account.provider, {
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: account.expires_at,
            })
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
      signIn: "/",
    },
    secret: process.env.NEXTAUTH_SECRET,
  }
}

export default async function auth(req, res) {
  return NextAuth(req, res, getAuthOptions(req))
}
