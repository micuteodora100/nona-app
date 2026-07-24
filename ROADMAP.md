# Nona — Product Roadmap

Last updated: 23 July 2026

T-shirt sizes: XS = half day | S = 1-2 days | M = 3-5 days | L = 1-2 weeks | XL = 3-4 weeks
Priority: P0 = do now | P1 = next sprint | P2 = next quarter | P3 = future

---

## ✅ Shipped

| Feature | Notes |
|---------|-------|
| ✅ Password gate | Web Crypto HMAC in Edge Middleware |
| ✅ Session expiry | 24h cookie, re-authenticates daily |
| ✅ Rate limiting | 5 attempts → 15 min lockout |
| ✅ Gmail OAuth | Read-only, working |
| ✅ AI morning brief | Bullet list, date-aware, scheduled vs action distinction |
| ✅ Email triage | Urgent/action only, noise filtered, explicit flag categories |
| ✅ Dismiss email permanently | × button on urgent/action — removes from triage + tasks forever |
| ✅ Handled email memory | Ticked tasks + dismissed emails never resurface |
| ✅ AI task parsing | Multi-task, date extraction from free text |
| ✅ Task grouping + editing | By date/tag/all toggle, inline edit |
| ✅ Email → task with AI description | Dedup by emailKey, AI extracts action + description |
| ✅ Single home page | Tasks → Calendar → Mail → Budget → Groceries |
| ✅ Week calendar | Navigation arrows, event dots, event list below |
| ✅ Voice capture | Mic button on home screen, multilingual, AI parses to dated tasks |
| ✅ Language selector | English, Français, Deutsch, Română, Italiano in Settings |
| ✅ Settings gear in header | Top-right, replaces bottom link |
| ✅ AI cost caching | Brief 6h, triage 3h — Refresh bypasses cache |
| ✅ Model routing | Haiku for tasks/email-to-task, Sonnet for brief/triage |
| ✅ Supabase sync | Cross-device persistence — tasks, profile, handled emails sync to cloud |
| ✅ HTTPS enforced | Vercel handles this |
| ✅ API keys server-side only | Never exposed to browser |
| ✅ Email data never stored | Processed in memory per request only |
| ✅ Gmail + Outlook connect simultaneously | Fixed 23 Jul 2026 — connecting one always silently disconnected the other. Root cause: NextAuth's JWT strategy rebuilds the session token from scratch on every fresh OAuth sign-in (`node_modules/next-auth/core/routes/callback.js`) and never carries forward whatever was already connected — not a cookie-size issue as first suspected. Fixed by manually decoding the existing session via `getToken()` and merging it before adding the new provider (`pages/api/auth/[...nextauth].js`). Access/refresh tokens also moved out of the session cookie into Supabase (`lib/tokens.js`) so the cookie stays small regardless. |
| ✅ Supabase email/password login actually works | Fixed 23 Jul 2026 — the login page appeared to silently do nothing after signing in. Cause: the Supabase client stored the session in localStorage, which the Edge middleware (cookie-only) could never see, so every request bounced back to `/login`. Switched to `@supabase/ssr`'s cookie-based client (`lib/supabase.js`, `middleware.js`). |
| ✅ Password visibility toggle | Show/Hide button on both the login page and the legacy password gate |
| ✅ Mail tab shows connected accounts | Small status pills at the top of Mail — see at a glance which of Gmail/Outlook are connected, so a failed connection is obvious without going to Settings |
| ✅ Disconnect one email account without losing the other | Fixed 23 Jul 2026 — "Disconnect all" was the only option, and it did exactly that even when clicked from just the Gmail or just the Outlook row. Each provider now has its own Disconnect; an explicit "Disconnect all" sits above both if you want to sign out of everything at once. |
| ✅ Email → Calendar auto-detection | Already shipped — triage extracts `calendar_events` from dated emails (bookings, flights, appointments) and auto-adds them to the week view. Flight reliability fixed 24 Jul 2026: (1) PDF-extracted e-ticket text was silently getting truncated out of the triage prompt whenever the email body before it was long — `pages/api/ai/index.js` now reserves room for the attachment text instead of slicing the concatenated string blind; (2) prompt now explicitly asks for a separate calendar event per flight leg (outbound + return) with route/flight-number titles; (3) `pages/api/email/gmail.js` was silently dropping any email past the 40-most-recent full-fetch cap — added a small subject-keyword top-up so older travel confirmations aren't skipped; (4) `pages/api/email/outlook.js` fetched all messages via an unbounded `Promise.all`, where one failed message took the whole inbox fetch down — switched to the same batched `allSettled` pattern Gmail already used. |
| ✅ Global email filter rules | Already shipped — Settings → Email filter rules, permanent sender/subject blocklist applied before triage |
| ✅ Voice: stop recording button | Already shipped — explicit red stop control while the mic is active |
| ✅ Voice: live transcript editing | Already shipped — transcript is editable before it's parsed into tasks |
| ✅ Tasks: date in front | Already shipped — date badge renders before the task text, not after |
| ✅ Full email body reading | Already shipped — up to 3000 chars of real body (plus PDF attachment text) per email, not just a 100-150 char preview |

---

## 🔴 P0 — Fix now

| Size | Feature | Notes |
|------|---------|-------|
| ✅ | **Outlook connection** | Done — Microsoft Graph API via proper OAuth 2.0, using a direct Azure app registration + a custom NextAuth provider (`pages/api/auth/[...nextauth].js`), not through Supabase's own Azure provider. Personal Microsoft accounts only (`/consumers` endpoint), `Mail.Read` scope. `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` confirmed working locally 23 Jul 2026 — make sure both are also set in Vercel. |

---

## 🟡 P1 — Next sprint (build now)

| Size | Feature | Notes |
|------|---------|-------|
| S | **AI context survey on first open** | 5 questions + scan 90 days emails → build personal context profile. Makes brief and triage more personalised. |
| M | **Task list needs real categorisation** | Right now everything an email turns into a task lands in one flat list — bills, groceries, job applications, and one-off personal emails all mixed together with no way to tell them apart at a glance. Needs a smarter default grouping (e.g. by source/type — "Bills & money", "Groceries/errands", "Applications", "Personal") instead of relying on the generic family/work/health/errands tags, which don't map well to the actual mix of things landing here from email triage. |
| L | **Multi-user readiness — not there yet** | Raised 23 Jul 2026: can other people use this now? Short answer: not safely yet, even though today's fixes made the mechanics *work*. Gaps: (1) `nona_user_data`/task sync is keyed off whichever OAuth email NextAuth considers "current," not off the Supabase Auth identity someone actually logged in with — a new person who signs into the app but hasn't yet connected Gmail/Outlook has no working sync at all; (2) the RLS policy on `nona_user_data` (`user_id LIKE '%@%'`) would let any authenticated Supabase user read/write any other user's row if ever queried directly with the publishable key — currently harmless only because the app always proxies through the server route with the service-role key, but it's a latent hole, not a real boundary; (3) `ANTHROPIC_API_KEY` is one shared key — every user's AI usage bills against the same Anthropic account. Fine for you + one trusted person who understands this; not ready to open up beyond that. |
| XL | **Supabase auth — proper login** | Email + password per user, replacing the shared `APP_PASSWORD`. The login page and cookie-based session now actually work end-to-end (fixed 23 Jul 2026), but see "Multi-user readiness" above — the identity model underneath still isn't unified enough to call this fully done. |

---

## 🔵 P2 — Next quarter

Audited 23 Jul 2026 — everything below is confirmed genuinely not built except the push notification row. Two natural groupings for future batching: the four **budget** rows (BIL/Revolut connections → Amazon/Lidl spend parsing → unified dashboard) form one sequence since each depends on the one before it; the two **grocery** rows (weekly offers + price comparison) form another and both just feed the still-placeholder Groceries tab.

| Size | Feature | Notes |
|------|---------|-------|
| M | **Waiting for replies tracker** | Scans sent Gmail, finds threads with no reply after 5 days. Important for job search but deprioritised vs other P1 items. |
| S | **Google Calendar integration** | Show real Google Calendar appointments in week view alongside tasks |
| M | **Document expiry reminders** | Passport, driving licence, residence permit, contrôle technique. One-time setup, reminds 6 weeks before. |
| S | **Crèche/school email parsing** | Detect crèche/school emails, extract dates/requirements/payments into tasks |
| M | **Morning brief push notification at 7am** | Partially built: subscribe/unsubscribe + service worker (`lib/push-client.js`, `public/sw.js`, `pages/api/push/subscribe.js`) and encrypted-token storage for cron access (`lib/tokens.js`, `oauth_tokens` table) all already exist. What's still missing: the actual scheduled trigger — no Vercel Cron config or `/api/cron/*` route exists yet to fire at 7am, generate the brief, and call the push send. |
| L | **BIL connection** | PSD2 via Nordigen/GoCardless. Read-only. |
| L | **Revolut connection** | Same PSD2 approach. Transactions, balance, categories. |
| M | **Amazon spend tracking** | Parse Amazon order confirmation emails — item, price, delivery date. No API needed. |
| M | **Lidl spend tracking** | Parse Lidl Plus receipt emails. |
| L | **Unified budget dashboard** | AI categorises all spend. This month vs last vs average. |
| M | **Weekly Lidl/Aldi offers** | Scrape lidl.lu/fr/offres + aldi.lu weekly (Thursdays). Alert when basket items on offer. |
| M | **Cactus/Auchan/Delhaize price comparison** | Full online catalogues scrapable. Everyday prices. |
| M | **Two-factor authentication** | TOTP via authenticator app |

---

## ⚪ P3 — Future

| Size | Feature | Notes |
|------|---------|-------|
| S | **Unusual spend alert** | "Amazon spend €340 this month vs avg €120" |
| M | **Subscription tracker** | Detect recurring charges, flag unused ones |
| L | **Smart basket builder** | Learn what you buy, alert when on offer, compare basket cost across stores |
| L | **Partner view** | Read-only summary for partner — makes invisible labour visible |
| M | **Pending job application tracker** | "Applied to X on 15 Jun — no reply in 12 days. Follow up?" |
| L | **Nona Pro — compliance officers** | Full YC pitch built. 60-day validation sprint first. |
| XL | **React Native / Expo native app** | True phone install, push notifications, offline |
| M | **WhatsApp group summariser** | WhatsApp Cloud API |
| XL | **Multi-language UI (FR, DE, RO)** | Voice input works in these languages already; full UI localisation is separate |
| XL | **Fit4Start application** | Next cohort — needs team of 2, SARL, prototype, 1 LOI |

---

## 📋 Decisions locked

- Design: `#0D0C0A` black, `#E8C87A` gold, Instrument Serif + Syne
- Home order: Tasks → Calendar → Mail → Budget → Groceries
- No tab bar — single scroll, drill-down with Back button
- Brief = bullet list of action items only, no narrative
- Tasks = separate date field, AI-parsed, grouped by date
- Email dismiss = permanent, synced to Supabase
- Outlook = direct Azure app registration + custom NextAuth provider (not Supabase's Azure provider)
