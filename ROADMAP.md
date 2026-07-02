# Nona — Product Roadmap

Last updated: July 2026

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

---

## 🔴 P0 — Fix now

| Size | Feature | Notes |
|------|---------|-------|
| XL | **Outlook connection** | Biggest blocker for daily use. Options: (1) Supabase Azure OAuth provider — redirect goes to Supabase, simpler than direct Azure; (2) Azure app registration pointing at Supabase callback URL. Need to configure in Supabase Dashboard → Authentication → Providers → Azure. |

---

## 🟡 P1 — Next sprint (build now)

| Size | Feature | Notes |
|------|---------|-------|
| M | **Email → Calendar auto-detection** | Triage detects dates/meetings/bookings in emails and auto-creates calendar events. "Lunch tomorrow at La Lorraine" → appears in week view with link to original email. No manual action needed. |
| S | **Global email filter rules** | User defines permanent rules once: "never show password change emails", "never show emails from Microsoft account team." Applied before triage — whole sender/subject pattern blocked forever. Stored in profile. |
| S | **Voice: stop recording button** | Explicit red stop button while mic is active. Currently stops only when you stop speaking — needs manual control. |
| S | **Voice: live transcript editing** | Show transcript as you speak. Allow tapping to correct words before AI parses into tasks. |
| S | **Tasks: date in front** | Move date badge to front of each task (left side) not end. Clearer visual hierarchy — date first, then text. |
| S | **Tasks: add to calendar button** | Calendar icon on any task with a date. Tap → task appears in week view. |
| M | **Full email body reading** | Currently only 100-150 char previews — dates and booking details missed. Needed for calendar auto-detection to work well. |
| S | **AI context survey on first open** | 5 questions + scan 90 days emails → build personal context profile. Makes brief and triage more personalised. |
| XL | **Supabase auth — proper login** | Email + password per user. Replaces shared APP_PASSWORD. Required before sharing with others. |

---

## 🔵 P2 — Next quarter

| Size | Feature | Notes |
|------|---------|-------|
| M | **Waiting for replies tracker** | Scans sent Gmail, finds threads with no reply after 5 days. Important for job search but deprioritised vs other P1 items. |
| S | **Google Calendar integration** | Show real Google Calendar appointments in week view alongside tasks |
| M | **Document expiry reminders** | Passport, driving licence, residence permit, contrôle technique. One-time setup, reminds 6 weeks before. |
| S | **Crèche/school email parsing** | Detect crèche/school emails, extract dates/requirements/payments into tasks |
| M | **Morning brief push notification at 7am** | PWA service worker or native app required |
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
- Outlook = top priority to fix via Supabase Azure OAuth
