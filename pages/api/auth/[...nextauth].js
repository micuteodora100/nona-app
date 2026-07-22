import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { createClient } from "@supabase/supabase-js"
import { encrypt } from "../../../lib/crypto"

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

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// Saves the refresh token (encrypted) so the 7am cron job can fetch email
// without an active browser session. Silently no-ops if not configured yet,
// so this never blocks a normal sign-in.
async function persistRefreshToken(userId, provider, refreshToken) {
  if (!refreshToken || !userId) return
  try {
    const supabase = getSupabaseServer()
    if (!supabase) return
    const encrypted = encrypt(refreshToken)
    await supabase
      .from("oauth_tokens")
      .upsert(
        { user_id: userId, provider, encrypted_refresh_token: encrypted, updated_at: new Date().toISOString() },
        { onConflict: "user_id,provider" }
      )
  } catch (err) {
    // Never break sign-in over token persistence — log and move on
    console.error("persistRefreshToken failed:", err.message)
  }
}

export const authOptions = {
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
        // Store each provider's token under its own key instead of one shared
        // slot — previously connecting Outlook after Gmail (or vice versa)
        // overwrote token.accessToken/token.provider, silently disconnecting
        // whichever was connected first even though both showed as "connected"
        // briefly. Now both persist side by side.
        if (!token.providers) token.providers = {}
        token.providers[account.provider] = {
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          email: profile?.email || token.email,
        }

        const userId = profile?.email || token.email
        // Google only issues a refresh_token on first consent — if this fires
        // again without one, the previously stored token is still valid.
        if (account.refresh_token) {
          await persistRefreshToken(userId, account.provider, account.refresh_token)
        }
      }
      return token
    },
    async session({ session, token }) {
      session.providers = token.providers || {}
      // Backward-compat: point the old single-slot fields at whichever provider
      // was connected most recently, so anything not yet migrated doesn't crash.
      const providerIds = Object.keys(session.providers)
      const last = providerIds[providerIds.length - 1]
      if (last) {
        session.accessToken = session.providers[last].accessToken
        session.provider = last
      }
      session.error = token.error
      return session
    },
  },
  pages: {
    signIn: "/",
  },
  secret: process.env.NEXTAUTH_SECRET,
}

export default NextAuth(authOptions)
