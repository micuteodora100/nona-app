// Deterministic bulk-mail filter, run in code *before* anything reaches the AI.
//
// Triage previously sent every fetched email to Claude on every refresh, so
// newsletters and promos were re-analysed (and re-paid for) indefinitely. Those
// are identifiable without a language model, so they're dropped here instead.
//
// Deliberately biased toward keeping mail. A false positive is invisible and
// expensive — an email she needed silently never reaches triage — while a false
// negative just costs a fraction of a cent. Every rule below is therefore
// narrow, and the rescue rules override all of them.
//
// The specific trap this is written around: "no-reply@" is NOT a noise signal.
// Train and plane tickets, government correspondence, and Amazon receipts are
// almost all sent from no-reply addresses, and some of them carry
// List-Unsubscribe too. Those are exactly the emails that matter most, so
// transactional intent always wins over any bulk-shaped signal.

// Anything matching these is never filtered, however bulk-shaped it looks.
// Written for Luxembourg: mail arrives in English, French, and German, so the
// obvious equivalents are included rather than assuming an English inbox.
const RESCUE_PATTERNS = [
  // money — incl. facture/Rechnung (invoice), remboursement (refund)
  /\b(invoice|facture|rechnung|payment|paiement|zahlung|paid|receipt|re[çc]u|quittung|bill|billing|due|overdue|refund|remboursement|charged|debit|pr[ée]l[èe]vement|subscription|abonnement|price increase)\b/i,
  // security / account access
  /\b(security|s[ée]curit[ée]|sicherheit|suspicious|password|mot de passe|passwort|verify|verification|v[ée]rification|code|2fa|two-factor|sign[- ]?in|log[- ]?in|connexion|unusual activity|breach|locked|bloqu[ée])\b/i,
  // travel + transport — the biggest false-positive risk, so cast wide
  /\b(flight|vol|flug|e-?ticket|billet|fahrkarte|ticket|itinerary|itin[ée]raire|boarding|embarquement|booking|r[ée]servation|reservation|buchung|train|rail|sncf|cfl|platform|quai|gleis|departure|d[ée]part|abfahrt|check-?in|pnr|seat|si[èe]ge)\b/i,
  // orders, deliveries, receipts (Amazon, Lidl, parcel carriers)
  /\b(order|commande|bestellung|your order|shipped|exp[ée]di[ée]|versandt|dispatch|delivery|livraison|lieferung|parcel|colis|paket|tracking|suivi|sendungsverfolgung|return|retour)\b/i,
  // government / administration — Luxembourg-specific terms included
  /\b(tax|imp[ôo]ts?|steuer|government|gouvernement|minist[èe]re|ministry|administration|commune|guichet|officiel|official|passport|passeport|reisepass|residence permit|titre de s[ée]jour|visa|social security|s[ée]curit[ée] sociale|pension|allocation|cnc|cns|ccss|adem|convocation|summons)\b/i,
  // commitments with a date attached
  /\b(appointment|rendez-?vous|termin|deadline|[ée]ch[ée]ance|expires?|expiring|expire|renew|renewal|renouvellement|cancel(l)?ation|annulation)\b/i,
  // things that need a reply from her
  /\b(interview|entretien|application|candidature|contract|contrat|vertrag|signature|sign here|action required|action requise|response required|confirm|confirmer|best[äa]tigen)\b/i,
]

// Senders whose mail is transactional by nature — carriers, government, banks,
// retailers she actually buys from. Rescued outright: these send from no-reply
// addresses and sometimes attach List-Unsubscribe even to a real receipt.
const TRANSACTIONAL_SENDER = /@[\w.-]*(sncf|cfl\.lu|cfl|trainline|bahn|db\.de|flibco|luxair|ryanair|easyjet|lufthansa|brusselsairlines|amazon|lidl|cactus|auchan|delhaize|paypal|revolut|bil\.lu|bgl|spuerkeess|post\.lu|dhl|ups|fedex|dpd|gls|colissimo|laposte|gouvernement\.lu|public\.lu|guichet\.lu|etat\.lu|impotsdirects|ccss\.lu|cns\.lu|adem\.lu|vdl\.lu)\b/i

// Marketing-shaped subjects. Only ever used in combination with a bulk-looking
// sender — on their own these match plenty of legitimate mail.
const MARKETING_SUBJECT = /(\d+\s*%\s*(off|de r[ée]duction|rabatt)|\bsales?\b|\bsoldes\b|\bdeals?\b|\bdiscount\b|\bnewsletter\b|\bwebinar\b|just for you|rien que pour vous|don'?t miss|last chance|derni[èe]re chance|limited time|new arrivals|shop now|d[ée]couvrez nos)/i

// Addresses that never expect a reply. NOT sufficient on its own — deliberately
// excludes no-reply/donotreply, because those carry the tickets, receipts, and
// government mail this filter must never touch.
const BULK_SENDER = /(^|[<\s.])(newsletter|newsletters|marketing|promo|promotions|mailer|campaign|news)@/i

function haystack(email) {
  return `${email.subject || ""} ${email.from || ""} ${email.snippet || ""}`
}

export function isRescued(email) {
  if (TRANSACTIONAL_SENDER.test(email.from || "")) return true
  const text = haystack(email)
  return RESCUE_PATTERNS.some((re) => re.test(text))
}

// True only when the email is near-certainly bulk mail she'd never action.
export function isBulkNoise(email) {
  if (!email) return false
  if (isRescued(email)) return false

  // RFC 2369: List-Unsubscribe is what bulk senders set and most transactional
  // mail doesn't. The highest-signal rule available, and the reason the Gmail
  // fetch now captures that header — but it only applies once every rescue
  // rule above has passed, since receipts sometimes carry it too.
  if (email.listUnsubscribe) return true

  // Fallback for sources without that header (Outlook — Graph doesn't return it
  // unless internetMessageHeaders is explicitly selected). Needs both signals,
  // since either alone is far too broad.
  if (BULK_SENDER.test(email.from || "") && MARKETING_SUBJECT.test(email.subject || "")) return true

  return false
}

// Splits a list into what triage should see and what it shouldn't. Returns the
// filtered-out mail too, so the UI can show what was skipped rather than
// silently dropping it — the same reason muted email collapses into its own
// section instead of disappearing.
export function partitionBulk(emails) {
  const keep = []
  const bulk = []
  for (const e of emails || []) {
    if (isBulkNoise(e)) bulk.push(e)
    else keep.push(e)
  }
  return { keep, bulk }
}
