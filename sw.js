// Nona push notification service worker

self.addEventListener("push", (event) => {
  let data = { title: "Nona", body: "You have a new update." }
  try {
    if (event.data) data = event.data.json()
  } catch (e) {
    // fall back to default text above
  }

  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "nona-morning-brief",
    renotify: true,
    data: { url: data.url || "/" },
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/"
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
