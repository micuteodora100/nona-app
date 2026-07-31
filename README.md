# Nona — AI-powered family operating system

Nona is a personal assistant designed to reduce the mental load of running a household. It brings together tasks, schedules, email, and family logistics into one daily view, using AI to surface what needs attention rather than requiring users to manually organize everything.

**Status:** MVP in active development.

Built independently from product concept through implementation, using Next.js, Supabase, Claude, and Vercel.

## Screenshots

<!-- TODO: add screenshots — e.g. daily brief, task list, email triage -->
<!-- ![Daily brief](docs/screenshot-daily-brief.png) -->
<!-- ![Tasks](docs/screenshot-tasks.png) -->

## What Nona does

**Daily brief → tasks → calendar → email triage → household logistics → proactive reminders**

- **Daily brief** — a single view of what actually needs attention today, generated fresh each morning
- **Tasks** — AI-categorized and prioritized, not just a flat to-do list
- **Calendar** — flight/e-ticket detection and scheduling pulled in automatically
- **Email triage** — Gmail and Outlook inboxes summarized and converted into actionable tasks, read-only
- **Household logistics** — recurring tasks and family-specific categories, not generic productivity buckets
- **Proactive reminders** — push notifications surface what matters without the user having to check in

---

## Setup Guide

### What you're deploying
A Next.js app that runs on Vercel (free tier). Your emails are read live via OAuth — never stored. The Claude API generates your brief and triage on the fly.

### Step 1 — Push to GitHub (5 min)

1. Go to github.com → New repository → name it `nona-app` → Create
2. In terminal (or GitHub Desktop):
```
cd nona-app
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/nona-app.git
git push -u origin main
```

### Step 2 — Deploy to Vercel (3 min)

1. Go to vercel.com → Sign up with GitHub
2. New Project → Import `nona-app`
3. Framework: Next.js (auto-detected)
4. **Don't deploy yet** — add env vars first (Step 4)

### Step 3A — Google Cloud (Gmail OAuth) — 15 min

1. Go to console.cloud.google.com
2. New Project → name it "Nona"
3. APIs & Services → Enable APIs → enable both **Gmail API** and **Google Calendar API**
4. OAuth consent screen:
   - User Type: External
   - App name: Nona
   - Your email for support
   - Add scopes: `https://www.googleapis.com/auth/gmail.readonly` and
     `https://www.googleapis.com/auth/calendar.readonly`
   - Add yourself as a Test User to get started. Before letting anyone else in,
     read *Letting other people test Nona* below — Testing mode caps you at 100
     named testers and expires their tokens weekly
5. Credentials → Create Credentials → OAuth Client ID
   - Application type: Web application
   - Authorised redirect URIs: `https://your-app.vercel.app/api/auth/callback/google`
   - Also add: `http://localhost:3000/api/auth/callback/google`
6. Copy **Client ID** and **Client Secret**

### Step 3B — Microsoft / Azure (Outlook mail, OneNote, calendar) — 10 min

> Outlook mail, OneNote and Outlook Calendar all go through Microsoft Graph with
> OAuth, so an app registration is required. (An earlier version of this guide
> said Outlook worked over IMAP with no Azure setup — that stopped being true
> once Graph replaced it, and `OUTLOOK_EMAIL`/`OUTLOOK_PASSWORD` are no longer
> used by anything.)

1. Azure Portal → App registrations → New registration
2. *Supported account types*: **Accounts in any organizational directory and
   personal Microsoft accounts** (anything narrower blocks work/school mailboxes)
3. Redirect URI (Web): `https://your-domain/api/auth/callback/microsoft`, plus
   `http://localhost:3000/api/auth/callback/microsoft` for local work
4. API permissions → Microsoft Graph → Delegated: `User.Read`, `Mail.Read`,
   `Notes.Read`, `Calendars.Read`, `offline_access`
5. Certificates & secrets → New client secret
6. Copy the **Application (client) ID** and the **secret value**

### Step 4 — Add environment variables to Vercel

In your Vercel project → Settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `NEXTAUTH_URL` | Your canonical URL, e.g. `https://www.your-domain.com` — must match the domain registered in Google Cloud and Azure, and is the host every OAuth cookie is tied to |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` and paste the output |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from console.anthropic.com |
| `GOOGLE_CLIENT_ID` | From Step 3A |
| `GOOGLE_CLIENT_SECRET` | From Step 3A |
| `MICROSOFT_CLIENT_ID` | From Step 3B |
| `MICROSOFT_CLIENT_SECRET` | From Step 3B |
| `RESEND_API_KEY` | (Optional) From resend.com — emails you when someone submits the /contact form |
| `CONTACT_NOTIFY_EMAIL` | (Optional) The inbox that should receive those notifications |

Then: **Deploy** in Vercel.

### Step 5 — Add to your Android home screen

1. Open your Vercel URL in **Chrome** (must be Chrome for PWA install)
2. Tap the **three-dot menu** (top right)
3. Tap **"Add to Home screen"** or **"Install app"**
4. Name it "Nona" → Add

It opens full-screen, no browser bar, like a native app. Chrome may also show a bottom install banner automatically — tap that if it appears.

## Letting other people test Nona

The code side is done — any signed-up Supabase user can connect their own Gmail,
Outlook and OneNote, and their tokens are keyed to their own identity. What gates
outside testers is provider configuration, and it's all dashboard work.

### Google (Gmail + Calendar) — the real gate

Nona asks for `gmail.readonly`, which Google classes as a **restricted** scope.
That has consequences no amount of code can change:

| Publishing status | Who can connect | Cost |
|---|---|---|
| **Testing** | Only accounts added by email under *Audience → Test users*, max 100 | Refresh tokens expire after **7 days**, so every tester has to reconnect weekly |
| **In production**, unverified | Anyone, after clicking through an "app isn't verified" warning (Advanced → Continue). Still capped around 100 users | Tokens behave normally — no weekly reconnect |
| **In production**, verified | Anyone, no warning | Requires Google's OAuth verification **and** a CASA security assessment for the restricted Gmail scope — weeks of lead time, and the assessment is a paid annual thing |

**For a friends-and-family beta, publish to production and stay unverified.** The
warning screen is the only cost, testers get through it in two taps, and it
avoids the weekly reconnect that makes Testing mode miserable to test with. The
in-app copy on the connect screen now tells people to expect that screen.

Steps: Google Cloud Console → APIs & Services → OAuth consent screen →
**Publish app**. Confirm both Gmail API and Google Calendar API are enabled, and
that the authorised redirect URI is `https://<your-domain>/api/auth/callback/google`
on the **canonical** domain — the one `NEXTAUTH_URL` points at (see the host note
below). Start verification separately if and when you outgrow ~100 users.

### Microsoft (Outlook mail + OneNote + calendar)

No verification process to clear — but the app registration has to accept other
people's account types, which by default it may not:

1. Azure Portal → App registrations → your app → **Authentication** →
   *Supported account types* → **Accounts in any organizational directory and
   personal Microsoft accounts**. Without this, work and school mailboxes are
   rejected before they ever reach Nona.
2. Redirect URI: `https://<your-domain>/api/auth/callback/microsoft`, again on the
   canonical domain.
3. API permissions (delegated): `User.Read`, `Mail.Read`, `Notes.Read`,
   `Calendars.Read`, `offline_access`. All user-consentable — no admin consent
   needed for personal accounts. Some corporate tenants require their own admin
   to approve third-party apps regardless; nothing to be done about that from
   here.
4. Optional: *Publisher verification* removes the "unverified" tag from the
   consent screen. Nice, not required.

OneNote needs no separate connection — it rides on the Outlook token via
`Notes.Read`, and testers pick which notebooks Nona may read in Settings.

### One host, always

OAuth state cookies are host-only, so a tester who starts on any host other than
the one `NEXTAUTH_URL` names cannot complete a connect (this is exactly what
broke the first outside tester — she was on a `*.vercel.app` deployment URL).
Middleware now redirects every production host to the `NEXTAUTH_URL` host, so
**share only that URL**, and keep `NEXTAUTH_URL` in step with the domain
registered in Google Cloud and Azure.

### What each tester does

1. Open the canonical URL and sign up (email + password, or magic link).
2. Connect Gmail and/or Outlook from Home — clicking through Google's beta
   warning if it appears.
3. That's it. Their tasks, tokens and spend data are scoped to their own account;
   nothing is shared between testers.

### Costs

| Service | Cost |
|---------|------|
| Vercel | Free (Hobby tier) |
| Google Cloud | Free (Gmail API has no cost for read-only) |
| Microsoft Azure | Free (app registration + delegated Graph permissions) |
| Anthropic API | ~$0.01–0.05 per brief/triage session |

### Local development

```
cp .env.example .env.local
# fill in your values
npm install
npm run dev
# open http://localhost:3000
```

### Email handling

- Reads unread emails from the last 48 hours via OAuth
- Sends subject lines and previews to Claude for triage
- **Never stores email content** — processed in memory per request
- **Read-only access** — Nona cannot send, delete, or modify anything
- Disconnect anytime from the Me tab or your Google/Microsoft account settings
