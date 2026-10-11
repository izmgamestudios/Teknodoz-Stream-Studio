/* Teknodoz Studio service worker.
 *
 * Deliberately small: it makes the app installable and keeps static files (hashed build assets,
 * fonts, icons) available offline. It NEVER touches /api/* (rooms, chat, live bridge), non-GET
 * requests or other origins, and it does not cache HTML (pages are server-rendered per brand):
 * when the network is down a navigation shows /offline.html instead.
 *
 * Bump VERSION to drop old caches. Registered only in production builds (src/studio/pwa/register.ts).
 */
const VERSION = "v1";
const STATIC = `tkz-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/favicon.ico"];
const CACHEABLE = ["/assets/", "/fonts/", "/icons/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("tkz-") && k !== STATIC)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((r) => r || new Response("Offline", { status: 503 })),
      ),
    );
    return;
  }

  if (CACHEABLE.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
