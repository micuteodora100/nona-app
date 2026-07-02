# Nona — Feature Backlog & Corrections

Last updated: July 2026

T-shirt sizes: XS = half day | S = 1-2 days | M = 3-5 days | L = 1-2 weeks | XL = 3-4 weeks

Priority: P0 = do now | P1 = next sprint | P2 = next quarter | P3 = future

---

## 🔴 Critical bugs (fix immediately)

| Priority | Size | Feature | Status |
|----------|------|---------|--------|
| P0 | S | Cross-device sync — tasks/profile reset on new browser/device | Open — needs Supabase |
| P0 | XS | Brief AI references past events (French exam) as upcoming | Fixed in code, deploy pending |
| P0 | XS | Handled email memory — ticked tasks resurface on next triage | Built (localStorage stopgap) |
| P1 | M | Outlook connection — IMAP blocked by Microsoft | Parked — needs Azure OAuth |

---

## 🔐 Security (do before sharing with anyone)

| Priority | Size | Feature | Notes |
|----------|------|---------|-------|
| P0 | S | **Rate limiting on password gate** | Lockout after 5 wrong attempts — currently brute-forceable |
| P0 | XS | **Session expiry** | Cookie lasts 90 days — should expire on browser close or 24h |
| P1 | L | **Supabase auth — proper login** | Email + password per user. Replaces APP_PASSWORD. Required before sharing with others |
| P2 | M | **Two-factor authentication** | TOTP via authenticator app |
| ✅ | — | HTTPS enforced | Done — Vercel handles this |
| ✅ | — | API keys never exposed to browser | Done — all server-side |
| ✅ | — | Email data never stored | Done — processed in memory only |

---

## 🏗 Foundation (unlocks everything else)

| Priority | Size | Feature | Notes |
|----------|------|---------|-------|
| P1 | XL | **Supabase backend** | Cross-device sync, persistent data, multi-user. Without this nothing else scales. |
| P1 | M | **Full email body reading** | Currently 100-150 char previews only — dates and amounts hidden in body are missed |
| P1 | S | **AI context survey on first open** | 5 questions + read 90 days emails to build personal context profile |

---

## 📱 Core features (high value, buildable now)

| Priority | Size | Feature | Notes |
|----------|------|---------|-------|
| P1 | S | **Voice capture** | Big mic button on home screen. Tap → speak → AI parses to dated tasks. Web Speech API already partially built. Primary capture method on mobile. |
| P1 | M | **Waiting for replies tracker** | Scans sent Gmail, finds threads with no reply after 5 days. "Still waiting on X recruiter since 12 Jun." Huge for job search. |
| P1 | M | **Email → Calendar events with links** | Detect flights, tickets, bookings from emails. Show in calendar with tap-to-open link to original email. "Flight to Nice 8 Jul 14:35 →" |
| P2 | S | **Google Calendar integration** | Show real Google Calendar appointments in week view alongside tasks |
| P2 | M | **Document expiry reminders** | Passport, driving licence, residence permit, contrôle technique. One-time setup, reminds 6 weeks before expiry. High value in Luxembourg. |
| P2 | S | **Crèche/school email parsing** | Detect crèche/school emails, extract dates, requirements, payments into tasks automatically |
| P2 | M | **Morning brief push notification at 7am** | PWA service worker or native app required |
| P3 | L | **Partner view** | Read-only summary for partner — makes invisible labour visible |
| P3 | XL | **Outlook OAuth** | Proper fix via Microsoft Azure — needs verified app registration |

---

## 💰 Budget & spending intelligence

| Priority | Size | Feature | Notes |
|----------|------|---------|-------|
| P2 | L | **BIL connection** | PSD2 via Nordigen/GoCardless. Read-only. No BIL credentials stored in Nona. |
| P2 | L | **Revolut connection** | Same PSD2 approach. Transactions, balance, merchant categories. |
| P2 | M | **Amazon spend tracking** | Parse Amazon order confirmation emails — structured HTML with item, price, delivery date. No API needed. |
| P2 | M | **Lidl spend tracking** | Parse Lidl Plus receipt emails. PSD2 shows total spend. |
| P2 | XS | **Aldi spend tracking** | PSD2 totals only — no itemised receipts available |
| P2 | L | **Unified budget dashboard** | AI categorises all spend: Groceries, Shopping, Subscriptions, Restaurants, Transport, Children, Health. This month vs last vs average. |
| P3 | S | **Unusual spend alert** | "Amazon spend €340 this month vs avg €120" — flags anomalies |
| P3 | M | **Subscription tracker** | Detect recurring charges from bank feed. Flag unused ones. "You're paying €22/month for Netflix." |

---

## 🛒 Grocery intelligence

| Priority | Size | Feature | Notes |
|----------|------|---------|-------|
| P2 | M | **Weekly Lidl/Aldi offers** | Lidl/Aldi publish offers only (not full catalogue) — updated Thursdays. Scrape lidl.lu/fr/offres and aldi.lu. Cross-reference with what you actually buy from receipt emails. "Chicken on offer at Lidl this week — €3.99/kg." |
| P2 | M | **Cactus/Auchan/Delhaize price comparison** | Full online catalogues scrapable. Compare everyday prices for common items. Lidl/Aldi everyday prices not publicly available. |
| P3 | L | **Smart basket builder** | Learn what you buy from Lidl Plus receipts + bank transactions. Alert when basket items go on offer. Show full basket cost at each supermarket. |

---

## 💡 Bigger future ideas

| Priority | Size | Feature | Notes |
|----------|------|---------|-------|
| P2 | XL | **Fit4Start application** | ~August 2026 deadline. Needs: Luxembourg SARL registered + prototype + 1 LOI. €150k non-dilutive. |
| P3 | L | **Nona Pro — compliance officers** | Full YC pitch built. 60-day validation sprint needed first. |
| P3 | XL | **React Native / Expo native app** | True phone install, push notifications, offline mode |
| P3 | M | **WhatsApp group summariser** | WhatsApp Cloud API |
| P3 | M | **Job board daily scrape** | LinkedIn, Indeed, Welcome to the Jungle |
| P3 | L | **Pending job application tracker** | "Applied to X on 15 Jun — no reply in 12 days. Follow up?" |
| P3 | XL | **Multi-language (FR, DE, RO)** | EN only for now |

---

## ✅ Done (shipped)

| Feature | Notes |
|---------|-------|
| Password gate | Web Crypto HMAC in Edge Middleware |
| Gmail OAuth | Read-only, working |
| AI morning brief | Bullet list, date-aware, no narrative |
| Email triage | Urgent/action only, noise filtered |
| AI task parsing | Multi-task, date extraction from free text |
| Task grouping + editing | By date/tag/all, inline edit of text/date/tag |
| Email → task with AI description | Dedup by emailKey, shows description |
| Single home page | Tasks → Calendar → Mail → Budget placeholder → Groceries placeholder |
| Week calendar | Navigation, event dots, list below |
| Focus tab | Removed |
| Tab bar | Removed |
| Outlook IMAP status checker | Test button in Settings, shows exact error |

---

## 📋 Decisions locked

- Design: `#0D0C0A` black, `#E8C87A` gold, Instrument Serif + Syne
- Home order: Tasks → Calendar → Mail → Budget → Groceries → Settings
- No tab bar — single scroll, drill-down with Back button
- Brief = bullet list of action items only, no narrative
- Tasks = separate date field, AI-parsed, grouped by date
- Outlook = parked until Azure OAuth solved
