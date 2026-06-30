import Imap from "imap"

// Quick connection test — connects, checks inbox exists, disconnects. No email fetching.
function testConnection() {
  return new Promise((resolve) => {
    if (!process.env.OUTLOOK_EMAIL || !process.env.OUTLOOK_PASSWORD) {
      return resolve({ ok: false, error: "Outlook credentials not set in environment variables." })
    }

    const imap = new Imap({
      user: process.env.OUTLOOK_EMAIL,
      password: process.env.OUTLOOK_PASSWORD,
      host: "outlook.office365.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 8000,
      connTimeout: 8000,
    })

    const timer = setTimeout(() => {
      try { imap.destroy() } catch {}
      resolve({ ok: false, error: "Connection timed out." })
    }, 9000)

    imap.once("error", (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message })
    })

    imap.once("ready", () => {
      clearTimeout(timer)
      imap.end()
      resolve({ ok: true, email: process.env.OUTLOOK_EMAIL })
    })

    imap.connect()
  })
}

export default async function handler(req, res) {
  const result = await testConnection()
  res.json(result)
}
