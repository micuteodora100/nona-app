// Client-side push notification helper.
// Call subscribeToPush() from a button — e.g. "Enable morning reminders" in Settings.

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

export async function isPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
}

export async function getPushPermissionState() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
  return Notification.permission // "granted" | "denied" | "default"
}

export async function subscribeToPush() {
  if (!(await isPushSupported())) {
    throw new Error("Push notifications aren't supported in this browser.")
  }

  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.")
  }

  const registration = await navigator.serviceWorker.register("/sw.js")
  await navigator.serviceWorker.ready

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidPublicKey) throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY")

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  })

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription }),
  })
  if (!res.ok) throw new Error("Failed to save subscription")

  return subscription
}

export async function unsubscribeFromPush() {
  if (!(await isPushSupported())) return
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await subscription.unsubscribe()
    await fetch("/api/push/subscribe", { method: "DELETE" })
  }
}
