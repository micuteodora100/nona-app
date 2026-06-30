# Nona — Setup Guide

## What you're deploying
A Next.js app that runs on Vercel (free tier). Your emails are read live via OAuth — never stored. The Claude API generates your brief and triage on the fly.

---

## Step 1 — Push to GitHub (5 min)

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

---

## Step 2 — Deploy to Vercel (3 min)

1. Go to vercel.com → Sign up with GitHub
2. New Project → Import `nona-app`
3. Framework: Next.js (auto-detected)
4. **Don't deploy yet** — add env vars first (Step 4)

---

## Step 3A — Google Cloud (Gmail OAuth) — 15 min

1. Go to console.cloud.google.com
2. New Project → name it "Nona"
3. APIs & Services → Enable APIs → search "Gmail API" → Enable
4. OAuth consent screen:
   - User Type: External
   - App name: Nona
   - Your email for support
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Add yourself as a Test User (your Gmail address)
5. Credentials → Create Credentials → OAuth Client ID
   - Application type: Web application
   - Authorised redirect URIs: `https://your-app.vercel.app/api/auth/callback/google`
   - Also add: `http://localhost:3000/api/auth/callback/google`
6. Copy **Client ID** and **Client Secret**

---

## Step 3B — Outlook (IMAP, no Azure needed) — 2 min

> No Azure, no OAuth, no app registration. Nona connects directly to your Outlook inbox via IMAP.

Nothing to set up here — just add your credentials in Step 4 below.

---

## Step 4 — Add environment variables to Vercel

In your Vercel project → Settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `NEXTAUTH_URL` | `https://your-app.vercel.app` (your actual Vercel URL) |
| `NEXTAUTH_SECRET` | Run `openssl rand -base64 32` and paste the output |
| `ANTHROPIC_API_KEY` | Your Anthropic API key from console.anthropic.com |
| `GOOGLE_CLIENT_ID` | From Step 3A |
| `GOOGLE_CLIENT_SECRET` | From Step 3A |
| `OUTLOOK_EMAIL` | `teodoramicu@outlook.com` |
| `OUTLOOK_PASSWORD` | Your Outlook password |

Then: **Deploy** in Vercel.

---

## Step 5 — Add to your Android home screen

1. Open your Vercel URL in **Chrome** (must be Chrome for PWA install)
2. Tap the **three-dot menu** (top right)
3. Tap **"Add to Home screen"** or **"Install app"**
4. Name it "Nona" → Add

It opens full-screen, no browser bar, like a native app. Chrome may also show a bottom install banner automatically — tap that if it appears.

---

## Costs

| Service | Cost |
|---------|------|
| Vercel | Free (Hobby tier) |
| Google Cloud | Free (Gmail API has no cost for read-only) |
| Microsoft Azure | Free (personal accounts) |
| Anthropic API | ~$0.01–0.05 per brief/triage session |

---

## Local development

```
cp .env.example .env.local
# fill in your values
npm install
npm run dev
# open http://localhost:3000
```

---

## What Nona does with your emails

- Reads unread emails from the last 48 hours via OAuth
- Sends subject lines and previews to Claude for triage
- **Never stores email content** — processed in memory per request
- **Read-only access** — Nona cannot send, delete, or modify anything
- Disconnect anytime from the Me tab or your Google/Microsoft account settings
