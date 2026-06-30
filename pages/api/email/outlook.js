import { getServerSession } from "next-auth"
import { authOptions } from "../auth/[...nextauth]"
import Imap from "imap"
import { simpleParser } from "mailparser"

// Outlook via IMAP — no OAuth needed, works with personal @outlook.com accounts
// Credentials stored securely in Vercel env vars, never in the app

function fetchOutlookEmails() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: process.env.OUTLOOK_EMAIL,
      password: process.env.OUTLOOK_PASSWORD,
      host: "outlook.office365.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    })

    imap.once("error", reject)

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) return reject(err)

        // Search ALL emails (read + unread) in the last 90 days
        const since = new Date()
        since.setDate(since.getDate() - 90)
        const dateStr = since.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

        imap.search([["SINCE", dateStr]], (err, uids) => {
          if (err) return reject(err)
          if (!uids || uids.length === 0) {
            imap.end()
            return resolve([])
          }

          const fetch = imap.fetch(uids.slice(-100), { bodies: ["HEADER.FIELDS (FROM SUBJECT DATE)", "TEXT"], struct: true })
          const emails = []

          fetch.on("message", (msg) => {
            let header = {}
            let snippet = ""

            msg.on("body", (stream, info) => {
              let buffer = ""
              stream.on("data", (chunk) => buffer += chunk.toString("utf8"))
              stream.once("end", () => {
                if (info.which.includes("HEADER")) {
                  const lines = buffer.split("\n")
                  lines.forEach(line => {
                    if (line.startsWith("From:")) header.from = line.replace("From:", "").trim()
                    if (line.startsWith("Subject:")) header.subject = line.replace("Subject:", "").trim()
                    if (line.startsWith("Date:")) header.date = line.replace("Date:", "").trim()
                  })
                } else {
                  snippet = buffer.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
                }
              })
            })

            msg.once("end", () => {
              emails.push({
                id: Date.now() + Math.random(),
                from: header.from || "",
                subject: header.subject || "(no subject)",
                date: header.date || "",
                snippet,
                source: "outlook",
              })
            })
          })

          fetch.once("error", reject)
          fetch.once("end", () => {
            imap.end()
            resolve(emails)
          })
        })
      })
    })

    imap.connect()
  })
}

export default async function handler(req, res) {
  if (!process.env.OUTLOOK_EMAIL || !process.env.OUTLOOK_PASSWORD) {
    return res.status(400).json({ error: "Outlook credentials not configured in environment variables." })
  }

  try {
    const emails = await fetchOutlookEmails()
    res.json({ emails, source: "outlook" })
  } catch (err) {
    console.error("IMAP error:", err.message)
    res.status(500).json({ error: err.message })
  }
}
