/* TABLZ service worker — offline shell + Web Push for the consumer PWA. */
const CACHE = "tablz-v1";
const SHELL = ["/", "/restaurants", "/offline", "/manifest.webmanifest"];

// next dev runs on a non-443 port (localhost:3000). Keep the worker network-
// only there so offline caching never interferes with HMR/dev tooling.
const IS_DEV = ["", "443", "80"].indexOf(String(self.location.port)) === -1;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------------------
// Web Push — payload shape sent by src/lib/push.ts:
//   { title, body, url, kind }
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  const title = data?.title || "TABLZ";
  const options = {
    body: data?.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [80, 40, 80],
    data: { url: data?.url || "/profile", kind: data?.kind || null },
    tag: data?.kind === "order_placed" || data?.kind === "payment_successful"
      ? undefined
      : data?.url || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/profile";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (new URL(win.url).pathname === new URL(url, self.location.origin).pathname) {
          return win.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("notificationclose", (event) => {
  event.notification.close();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (IS_DEV) return;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API traffic — prices and availability must stay fresh.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match("/offline")),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
