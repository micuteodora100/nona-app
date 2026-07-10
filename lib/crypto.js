import crypto from "crypto"

// AES-256-GCM encryption for OAuth refresh tokens stored in Supabase.
// Refresh tokens are long-lived credentials to your Gmail/Outlook inbox —
// they must never be stored in plain text, even in a database only Nona touches.

const ALGO = "aes-256-gcm"

function getKey() {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error("ENCRYPTION_KEY env var not set")
  // Normalize any-length secret into a 32-byte key
  return crypto.createHash("sha256").update(secret).digest()
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const key = getKey()
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

export function decrypt(payload) {
  const raw = Buffer.from(payload, "base64")
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const key = getKey()
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
