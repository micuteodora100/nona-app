# Nona — Product Roadmap

Last updated: July 2026

T-shirt sizes: XS = half day | S = 1-2 days | M = 3-5 days | L = 1-2 weeks | XL = 3-4 weeks
Priority: P0 = do now | P1 = next sprint | P2 = next quarter | P3 = future

---

## ✅ Shipped

| Feature | Notes |
|---------|-------|
| ✅ Password gate | Web Crypto HMAC in Edge Middleware — protects entire app |
| ✅ Gmail OAuth | Read-only, working |
| ✅ AI morning brief | Bullet list, date-aware, no narrative, distinguishes scheduled vs action items |
| ✅ Email triage | Urgent/action only, noise filtered, explicit flag categories |
| ✅ Dismiss email permanently | × button on urgent/action items — removes from triage + tasks forever |
| ✅ Handled email memory | Ticked tasks + dismissed emails never resurface on next triage |
| ✅ AI task parsing | Multi-task, date extraction from free text, compound input |
| ✅ Task grouping + editing | By date/tag/all toggle, inline edit of text/date/tag |
| ✅ Email → task with AI description | One-click, dedup by emailKey, AI extracts clean action + description |
| ✅ Single home page | Tasks → Calendar → Mail → Budget placeholder → Groceries placeholder |
| ✅ Week calendar | Navigation arrows, event dots on days with tasks, event list below |
| ✅ Outlook IMAP status checker | Test button in Settings shows exact connection error |
| ✅ HTTPS enforced | Vercel handles this — all traffic encrypted |
| ✅ API keys server-side only | Never exposed to browser |
| ✅ Email data never stored | Processed in memory per request only |
| ✅ Focus tab removed | Was unused and added noise |
| ✅ Tab bar removed | Single scroll home page with drill-down screens |

---

## 🔴 P0 — Fix now

| Size | Feature | Notes |
|------|---------|-------|
| ✅ | **Rate limiting on password gate** | Done — 5 attempts then 15 min lockout, shows countdown |
| ✅ | **Session expiry** | Done — 24h session, re-authenticates daily |
| S | **Cross-device sync** | Tasks/profile live in localStorage only — phone and laptop show different state. Needs Supabase. |

---

## 🟡 P1 — Next sprint (high value, do soon)

| Size | Feature | Notes |
|------|---------|-------|
| ✅ | **Voice capture** | Done — prominent mic button on home screen, real-time transcript, AI parses to dated tasks |
| M | **Waiting for replies tracker** | Scans sent Gmail, finds threads with no reply after 5 days. "Still waiting on X recruiter since 12 Jun." Critical for job search. |
| M | **Email → Calendar events with links** | Detect flights, hotel bookings, concert tickets, appointments from emails. Show in week calendar with tap-to-open link. "Flight to Nice 8 Jul 14:35 →" |
| M | **Full email body reading** | Currently only 100-150 char previews — dates and amounts missed. Needed for accurate task/date extraction. |
| S | **AI context survey on first open** | 5 questions + scan 90 days emails → build personal context profile. Makes brief and triage much more personalised. |
| XL | **Supabase backend** | Cross-device sync, persistent data, multi-user. Unlocks everything else. Without this nothing scales. |

---

## 🔵 P2 — Next quarter

| Size | Feature | Notes |
|------|---------|-------|
| L | **Supabase auth — proper login** | Email + password per user. Replaces shared APP_PASSWORD. Required before sharing with others. |
| S | **Google Calendar integration** | Show real Google Calendar appointments in week view alongside tasks |
| M | **Document expiry reminders** | Passport, driving licence, residence permit, contrôle technique. One-time setup, reminds 6 weeks before. High value in Luxembourg. |
| S | **Crèche/school email parsing** | Detect crèche/school emails, extract dates/requirements/payments into tasks automatically |
| M | **Morning brief push notification at 7am** | PWA service worker or native app required |
| L | **BIL connection** | PSD2 via Nordigen/GoCardless. Read-only. No BIL credentials stored. |
| L | **Revolut connection** | Same PSD2 approach. Transactions, balance, merchant categories. |
| M | **Amazon spend tracking** | Parse Amazon order confirmation emails — item, price, delivery date. No API needed. |
| M | **Lidl spend tracking** | Parse Lidl Plus receipt emails. PSD2 shows total spend. Combine for full picture. |
| XS | **Aldi spend tracking** | PSD2 totals only — no itemised receipts available from Aldi |
| L | **Unified budget dashboard** | AI categorises all spend: Groceries, Shopping, Subscriptions, Restaurants, Transport, Children, Health. This month vs last vs average. |
| M | **Weekly Lidl/Aldi offers** | Scrape lidl.lu/fr/offres + aldi.lu weekly (Thursdays). Cross-reference with what you actually buy. "Chicken on offer at Lidl this week — €3.99/kg." |
| M | **Cactus/Auchan/Delhaize price comparison** | Full online catalogues scrapable. Everyday prices for common items. Lidl/Aldi everyday prices not publicly available. |
| M | **Two-factor authentication** | TOTP via authenticator app |

---

## ⚪ P3 — Future

| Size | Feature | Notes |
|------|---------|-------|
| S | **Unusual spend alert** | "Amazon spend €340 this month vs avg €120" — flags anomalies automatically |
| M | **Subscription tracker** | Detect recurring charges from bank feed. Flag unused ones. "You're paying €22/month for Netflix." |
| L | **Smart basket builder** | Learn what you buy from Lidl Plus receipts + bank transactions. Alert when basket items go on offer. Full basket cost at each supermarket. |
| L | **Partner view** | Read-only summary for partner — makes invisible labour visible |
| XL | **Outlook OAuth** | Proper fix via Microsoft Azure — needs verified app registration. Currently IMAP is blocked by Microsoft. |
| L | **Pending job application tracker** | "Applied to X on 15 Jun — no reply in 12 days. Follow up?" Cross-references sent emails with job context. |
| L | **Nona Pro — compliance officers** | Full YC pitch built. 60-day validation sprint needed first. |
| XL | **React Native / Expo native app** | True phone install, push notifications, offline mode |
| M | **WhatsApp group summariser** | WhatsApp Cloud API — summarise family/school group chats |
| M | **Job board daily scrape** | LinkedIn, Indeed, Welcome to the Jungle — surface relevant roles automatically |
| XL | **Multi-language (FR, DE, RO)** | EN only for now |
| XL | **Fit4Start application** | Next cohort — needs team of 2, registered SARL, prototype, 1 LOI |

---

## 📋 Decisions locked (do not revisit unless Teodora initiates)

- Design: `#0D0C0A` black, `#E8C87A` gold, Instrument Serif + Syne
- Home order: Tasks → Calendar → Mail → Budget → Groceries → Settings
- No tab bar — single scroll, drill-down with Back button
- Brief = bullet list of action items only, no narrative paragraphs
- Tasks = separate date field, AI-parsed on entry, grouped by date by default
- Outlook = parked until Azure OAuth properly solved
- Email dismiss = permanent, stored in localStorage (Supabase when available)
