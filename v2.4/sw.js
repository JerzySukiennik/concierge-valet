/* Service worker: push notifications, and every file of the app is revalidated with the server on each load so a new version shows up at once. Nothing is cached here. A tapped notification asks the page to hand over to the native iPhone app. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const fresh = e.request.mode === "navigate" ? fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(e.request, { cache: "no-cache" });
  e.respondWith(fresh.catch(() => fetch(e.request)));
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Valet", { body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "valet", renotify: true }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
    for (const c of list) {
      if (!("focus" in c)) continue;
      const shown = await c.focus().catch(() => c);
      (shown || c).postMessage({ t: "native" });
      return;
    }
    return self.clients.openWindow("./?native=1");
  }));
});
