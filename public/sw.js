// Minimal push-only service worker — no offline caching/asset strategy,
// this app doesn't need to work offline, it only needs a background
// context alive to receive push events and show a real OS notification.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Ginny House", body: event.data.text() };
  }

  const title = payload.title || "Ginny House";
  const options = {
    body: payload.body || "",
    icon: "/brand/icon-square.png",
    badge: "/brand/icon-square.png",
    data: { url: payload.url || "/calendar" },
    tag: payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an already-open tab on the target URL instead of always opening a
// new one — most people leave the app open in a background tab/PWA window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/calendar";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
