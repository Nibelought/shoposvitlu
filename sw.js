/* Service worker: app shell works offline; schedule data is network-first so it is never stale when online. */
const VERSION = "v1";
const SHELL_CACHE = "shell-" + VERSION;
const DATA_CACHE = "data-" + VERSION;
const SHELL = [
  "./", "index.html", "style.css", "logic.js", "app.js", "favicon.svg",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") { return; }
  const url = new URL(req.url);
  if (url.origin !== location.origin) { return; }

  if (url.pathname.includes("/data/")) {
    // Network first; fall back to the last copy when offline. Key ignores the ?t= cache-buster.
    const key = url.origin + url.pathname;
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA_CACHE).then((c) => c.put(key, copy)); }
        return res;
      }).catch(() => caches.match(key).then((hit) => hit || Response.error()))
    );
    return;
  }

  // App shell: stale-while-revalidate (instant load, refreshed in the background for next time).
  event.respondWith(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        const refresh = fetch(req).then((res) => {
          if (res.ok) { cache.put(req, res.clone()); }
          return res;
        }).catch(() => hit);
        return hit || refresh;
      })
    )
  );
});
