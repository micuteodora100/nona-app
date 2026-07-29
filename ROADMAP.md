# Nona — Product Roadmap

Last updated: 28 July 2026 (multi-user migration, RLS verified live, sign-out fix, UI polish)

T-shirt sizes: XS = half day | S = 1-2 days | M = 3-5 days | L = 1-2 weeks | XL = 3-4 weeks
Priority: P0 = do now | P1 = next sprint | P2 = next quarter | P3 = future

---

## ✅ Shipped

| Feature | Notes |
|---------|-------|
| ✅ Fixed real root cause of missing flight/PDF dates | Fixed 29 Jul 2026 — debugged live against Teodora's real inbox and real Luxair e-ticket PDF (read-only, using the app's own stored OAuth tokens). Two separate issues found and fixed: (1) `pdf-parse` strips spaces between words ("14Aug2026", "MicuTeodoraMrs") — new `lib/pdf-text.js` re-inserts them, wired into both `gmail.js` and `outlook.js`. (2) The actual root cause: the "dismiss email forever" key was `sender::subject`, and automated senders (Luxair, banks, etc.) reuse the identical subject for every message — completing one old flight task had silently blacklisted every future email with that sender+subject, including her real upcoming Aug 14 flight. Switched the key to the email's own id (Gmail/Outlook message id, genuinely unique per message) in `triageEmails`/`dismissEmail`/`addEmailAsTask`. The one-click mute-by-sender feature is unaffected — that's intentionally pattern-based. |
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
| ✅ Warm light theme | Shipped 24 Jul 2026 — replaced the dark theme app-wide, see Decisions locked below |
| ✅ Unified speak-or-type capture on Home | Shipped 24 Jul 2026 — the Home "What's on your mind?" box used to be voice-only with no typed fallback; it's now one input either typed or dictated into (mic toggles to a send button once there's text), same AI parser either way |
| ✅ Calendar click-to-add | Shipped 24 Jul 2026 — tapping a day in the week view opens an inline quick-add scoped to that date, bypassing the AI's own date-guessing since the date is already explicit |
| ✅ Avatar | Shipped 24 Jul 2026 — upload a photo (resized/compressed client-side, stored inline in `profile` as a data URI, no new storage infra) or fall back to a colored-initial circle; shown top-left on Home, editable in Settings |
| ✅ Home screen restructure | Shipped 24 Jul 2026 — new order: weather widget + greeting → morning brief (was generated but never actually rendered anywhere — real gap, now fixed) → calendar → capture box → Mail / Notes & Tasks as two tappable rows (both collapsed, tap through rather than showing lists inline). Budget/Groceries placeholders removed from Home until built for real. Also fixed a real timezone bug found while testing this: date-only strings were round-tripped through UTC-aware `Date` methods (`toISOString()`, `new Date(isoString)`), which silently shifts the displayed/stored day by one for any timezone not exactly on UTC (Luxembourg included) — replaced with local-safe `parseLocalDate`/`toISODate` helpers in `pages/index.js`. |
| ✅ Task categorisation | Shipped 24 Jul 2026 — root cause was that batch email-triage tasks were hardcoded to `tag: "work"` client-side (`pages/index.js`), never even asked the AI to categorize per-item, unlike single email→task conversion which already did. Replaced the fixed family/work/health/errands taxonomy with a user-customizable category list (`lib/categories.js`, default: Applications, Bills & money, Groceries & errands, Family, Health) editable in Settings — add/rename/remove, with stable ids so renames propagate to existing tasks and removed categories leave old tasks visible (grouped under a fallback label) instead of disappearing. All three AI tagging paths (triage, email→task, free-text parse) now receive the user's actual current category list and tag against it, so custom categories get picked up automatically. |
| ✅ Public marketing site | Shipped 27 Jul 2026 — footer with About/Contact/Privacy/Terms/Unsubscribe on every public page (`components/MarketingLayout.js`), mailing-list signup (capture-only, `mailing_list_subscribers` table), `/contact` form (`contact_messages` table) instead of a public email address. `middleware.js`'s allowlist is default-deny — any new public route needs adding there or it silently redirects to `/login`. |
| ✅ Contact form emails the founder | Shipped 28 Jul 2026 — `/contact` submissions still save to Supabase, and now also send a best-effort email via Resend (`RESEND_API_KEY`/`CONTACT_NOTIFY_EMAIL` env vars) so they don't require manually checking the table. `reply_to` is set to the visitor's address so replying goes straight to them; the founder's real inbox is never exposed client-side. |
| ✅ Task cards restyled as sticky notes | Shipped 24 Jul 2026 — each category now carries a pastel `color` (`lib/categories.js`), and task cards render as solid-color notes with a drop shadow and a small stable per-item tilt (hashed from the task id, so it doesn't jitter on re-render) instead of a flat white-bordered list — categories are visually distinguishable at a glance, not just by a small badge. Old categories saved before `color` existed get backfilled automatically (matched by id to the current defaults, or a palette pick) so nothing collapses to one flat color. Also fixed low-contrast coral-on-pale-coral text (Mail tab's connected-account pills, selected filter/group-by chips, category badges) that read as washed-out pink and was hard to read — replaced with solid coral fill + dark ink text (or a neutral dark overlay for badges sitting on top of note colors). |
| ✅ Multi-user identity migration | Shipped 28 Jul 2026 — the actual P0 blocker below. All app data (`nona_user_data`, `push_subscriptions`, `oauth_tokens`) now keys off Supabase Auth's `user.id` (`auth_user_id`) instead of whichever NextAuth OAuth email was last connected. New `lib/supabase-auth.js` is the one place API routes check identity; NextAuth/OAuth is now used only to obtain Gmail/Outlook access tokens, tagged with the logged-in Supabase user at connect-time (`pages/api/auth/[...nextauth].js`). Existing data migrated via `supabase/multi-user-migration.sql` (additive, non-destructive) — Teodora's tasks had actually split across two rows (Gmail-keyed vs Outlook-keyed, 60 + 51 tasks) because of this exact bug; merged to 69 deduped tasks with nothing deleted. OAuth disconnect now revokes the token with Google itself (`lib/tokens.js`'s `revokeProviderToken`), not just deletes our copy. Legacy shared-password gate (`/gate`, `pages/api/auth-gate.js`) retired — Supabase Auth login is the only way in now. **Follow-up bug found in first live test:** the frontend (`pages/app.js`) was still gating cloud sync and all "connected" UI off the NextAuth session instead of the new Supabase identity — fixed same day, plus a new `/api/auth/provider-status` endpoint so "connected" status reflects the real `oauth_tokens` row instead of the browser's ephemeral NextAuth cookie. |
| ✅ Fixed task-loss bug in cloud sync | Shipped 28 Jul 2026 — found via live testing right after the migration above: `loadFromSupabase()` unconditionally replaced the whole local tasks array with the cloud snapshot, so a task added moments before that fetch resolved (or one still waiting on the 2s debounced save when the tab was closed/reloaded) got silently erased. Now merges instead of replacing, and flushes any pending save immediately on tab-hide/pagehide so a quick reload can't race the debounce. |
| ✅ Morning brief grouped by category | Shipped 28 Jul 2026 — brief was a flat 5-bullet list; now groups items under the user's own task categories (Settings → Task categories) instead, so it reflects whatever categories she's actually defined and picks up renames automatically. |
| ✅ One-click mute + grouped muted-emails view | Shipped 28 Jul 2026 — global email filter rules already existed (Settings) but only via manually typing a rule, and a muted email vanished with no way to check what got hidden. Added a 🔇 button on any email in Mail → "Show all emails" that mutes the sender in one click, and muted emails now collapse into their own "Muted (N)" section instead of disappearing entirely. |
| ✅ Minimal per-user AI usage guardrail | Shipped 28 Jul 2026 — the "one shared ANTHROPIC_API_KEY" half of the security-hardening row below. `ai_usage_daily` table + `increment_ai_usage()` Postgres function, checked in `pages/api/ai/index.js`; configurable via `DAILY_AI_LIMIT` env var (default 200/day), fails open (logs and continues) if the SQL hasn't been run yet rather than blocking normal use. |
| ✅ RLS tightened on all user data tables | Shipped 28 Jul 2026 — `supabase/rls-tightening.sql` run and verified live: queried `nona_user_data`/`push_subscriptions`/`oauth_tokens` directly with the public/anon key and confirmed "permission denied" on all three (previously wide open `USING (true)`). Closes the last latent hole from the security-hardening row above. |
| ✅ Sign out button + account-switch cache fix | Shipped 28 Jul 2026 — there was no plain sign-out, only "Reset Nona" (which also wipes local data). Added a proper Sign out button, and while building it found the gap it exposed: `localStorage` is one browser-wide cache with no owner tag, so switching Supabase accounts on the same browser without a full reset could let the previous account's cached-but-unsynced tasks get merged into the new account's cloud data by the safe-merge sync logic — the same class of cross-account bleed the identity migration was meant to close, via a different path. Every local save now tags the cache with the logged-in account's id; a mismatch on sign-in clears local state first. |
| ✅ Home/calendar/tasks UI polish | Shipped 28 Jul 2026 — capture box ("Speak or type what's on your mind") moved to the top of Home, right under the greeting. Calendar day-number circles enlarged (26px/11px → 32px/15px) for legibility. Tasks tab now defaults to grouped-by-category instead of by-date, so it reads as titled sections (Work, Family, ...) rather than one mixed list; tightened card spacing and softened the per-card tilt (±1.5deg → ±0.8deg) so grouped sections read as organized, not scattered. |

---

## 🔴 P0 — Fix now (blocking: sharing Nona with anyone else)

| Size | Feature | Notes |
|------|---------|-------|
| ✅ | **Outlook connection** | Done — Microsoft Graph API via proper OAuth 2.0, using a direct Azure app registration + a custom NextAuth provider (`pages/api/auth/[...nextauth].js`), not through Supabase's own Azure provider. Personal Microsoft accounts only (`/consumers` endpoint), `Mail.Read` scope. `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` confirmed working locally 23 Jul 2026 — make sure both are also set in Vercel. |
| ✅ | **Multi-user login — unify the identity model** | Done 28 Jul 2026 — see the Shipped entry above for the full writeup. Sync/tokens now key off Supabase Auth `user.id`, existing data migrated, legacy password gate retired, frontend session bug found in live testing and fixed, account-switch cache bleed fixed. |
| ✅ | **Security hardening before sharing** | Done 28 Jul 2026 — both halves shipped: per-user AI usage guardrail, and RLS tightened + verified live with a direct anon-key query. See Shipped above. |
| S | **Verify with a genuinely second account** | The only item left before this P0 section is fully closed. Needs: a second real Supabase Auth account (separate email), ideally in an incognito window; confirm its tasks/profile/Gmail-or-Outlook connection are fully isolated from Teodora's; specifically re-test logging in as one account right after the other **on the same browser** (the exact scenario the old bugs would have broken, now fixed twice over). Claude can't create the account or enter a password (credential-entry is off-limits) — this one needs Teodora to click through it, with Claude verifying the resulting data via read-only DB checks. |

---

## 🟡 P1 — Next sprint (build now)

| Size | Feature | Notes |
|------|---------|-------|
| M | **Natural-language command box** | Raised 28 Jul 2026 — type (or say) any instruction ("mute IBKR", "move brief to 8am", "delete the dentist task") and Claude maps it to one of a defined set of app actions via tool-calling, reusing the existing `/api/ai` pattern. Not literally open-ended — needs an explicit action schema (add/edit/delete task, mute sender, change a setting, etc.), and destructive actions (delete, mute) should confirm before firing rather than executing silently on a misread instruction. Cost is a non-issue: ~$0.001/command on Haiku 4.5 at typical size, well inside the existing `DAILY_AI_LIMIT` guardrail. Queued to start after the two open P0 verification items above are done. |
| M | **AI context survey on first open** | Refined 28 Jul 2026. Onboarding now does more than 5 fixed questions: (1) explicitly asks which task groupings/categories the person actually cares about, rather than silently defaulting to the fixed starter set; (2) scans the last 90 days of email (reusing the existing Gmail/Outlook fetch) and has the AI detect the most common real patterns in the inbox — recurring senders, subject clusters (e.g. "frequent IBKR account emails", "school newsletters", "Amazon orders"); (3) surfaces 2-3 targeted questions about those *actual* detected groups, not generic ones, and asks which of the detected buckets are relevant; (4) uses the answers to pre-populate both the category list and the mute-rule list (`profile.emailFilters`) together, so day one already reflects the real inbox instead of the person discovering muting/categories manually later. Queued as the second overnight routine, 28→29 Jul 2026. |
| S | **OneNote connection (read-only)** | Raised 28 Jul 2026. Scope: read-only, via Microsoft Graph (`Notes.Read`), same OAuth pattern as the existing Outlook integration — feeds OneNote content in as extra context for the brief/triage/context-survey, nothing written back. `Notes.Read` added to the Azure app registration 28 Jul 2026 — unblocked. Queued as the third overnight routine, 28→29 Jul 2026. |
| S | **Branded Supabase Auth emails** | Raised 28 Jul 2026 — confirmation emails were coming from Supabase's default relay ("powered by Supabase" branding), confusing for new signups. Fixed same day: Supabase custom SMTP now routed through Resend (same account already used for `/contact` emails), sender name "Nona", and the "Confirm signup" template rewritten to drop Supabase branding. Dashboard-only change, no code. |

---

## 🔵 P2 — Next quarter

Audited 23 Jul 2026 — everything below is confirmed genuinely not built except the push notification row. Two natural groupings for future batching: the four **budget** rows (BIL/Revolut connections → Amazon/Lidl spend parsing → unified dashboard) form one sequence since each depends on the one before it; the two **grocery** rows (weekly offers + price comparison) form another and both just feed the still-placeholder Groceries tab.

| Size | Feature | Notes |
|------|---------|-------|
| M | **Waiting for replies tracker** | Scans sent Gmail, finds threads with no reply after 5 days. Queued as an overnight routine, 28→29 Jul 2026. |
| S | **Google Calendar integration** | Show real Google Calendar appointments in week view alongside tasks. `calendar.readonly` scope added to the Google Cloud OAuth consent screen 28 Jul 2026 — unblocked. Queued as an overnight routine, 28→29 Jul 2026. |
| S | **Outlook Calendar integration** | Raised 28 Jul 2026 — same as Google Calendar but for Outlook, via Microsoft Graph `Calendars.Read` on the same Azure app registration already used for Mail.Read/Notes.Read. **Blocked**: needs `Calendars.Read` added in Azure (portal.azure.com → App registrations → your app → API permissions → same place Notes.Read was added) before it can be queued. |
| M | **Read Slack into tasks** | Raised 28 Jul 2026 — read a Slack channel and surface actionable messages as tasks, mirroring the already-listed WhatsApp summariser idea (P3). **Blocked**: needs a Slack App created at api.slack.com, installed to the workspace, with a bot token scoped to `channels:history`/`channels:read` (or the private-channel equivalents) — a new external service, not something to queue blind. |
| M | **Document expiry reminders** | Passport, driving licence, residence permit, contrôle technique. One-time setup, reminds 6 weeks before. |
| M | **Morning brief push notification at 7am** | Built 29 Jul 2026 on `feature/push-cron` (static implementation + `npm run build` only — no live send, no VAPID keys generated, needs Teodora's review): `pages/api/cron/morning-brief.js`, wired via a `crons` entry in `vercel.json` at 05:00 UTC (7am CEST — DST drift flagged, see PR). Iterates every `push_subscriptions` row, loads that user's own tasks/profile/tokens, reuses the app's own email-fetch (`lib/email-fetch.js`, factored out of `pages/api/email/gmail.js`/`outlook.js`) and triage/brief prompts (`lib/ai-brief.js`, factored out of `pages/api/ai/index.js`) so the push text is generated the same way the in-app brief is. Per-user try/catch so one failure can't take down the run. Needs manual owner steps before it can fire for real: generate + set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` and `CRON_SECRET` in Vercel env vars (see `.env.example`) — see PR description's "Pending decisions" for the DST/timezone caveat, the per-user `profile.briefTime` field that already exists but isn't wired up yet, and cron-duration risk at scale. |
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

- Design: warm light theme (24 Jul 2026, replaces the original dark theme below) — `#FBF6EE` cream background, `#2A2733` ink text, `#FF6B4A` coral accent, white cards with soft shadow, Instrument Serif + Syne. Colors are CSS custom properties (`--bg`, `--black`, `--gold`, `--white`, `--muted`, `--surface`, `--border` in `pages/index.js`'s global style block) — variable *names* were kept as-is to avoid a ~120-usage rename, but their roles shifted (e.g. `--black` is now the contrast color used on top of accent-filled buttons, not the page background). ~~Original: `#0D0C0A` black, `#E8C87A` gold~~ — superseded, kept here for history.
- Home order: Tasks → Calendar → Mail → Budget → Groceries
- No tab bar — single scroll, drill-down with Back button
- Brief = bullet list of action items only, no narrative
- Tasks = separate date field, AI-parsed, grouped by date
- Email dismiss = permanent, synced to Supabase
- Outlook = direct Azure app registration + custom NextAuth provider (not Supabase's Azure provider)
