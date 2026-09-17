self.addEventListener("fetch", (event) => {
  // Pass-through (no offline caching yet) — required for Chrome's "Install app" prompt.
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let data = { title: "🚨 New Order!", body: "A new café order just came in." };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/72x72/1f6d2.png",
      badge: "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/assets/72x72/1f6d2.png",
      vibrate: [300, 100, 300, 100, 300, 100, 300],
      requireInteraction: true,
      tag: "shrijimess-order"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("panel=kitchen") && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("./?panel=kitchen");
    })
  );
});

