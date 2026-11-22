// Offline support. Hashed assets are cache-first; pages try the network, then the last copy seen.
const CACHE = "lathe-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const keep = (res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; };
  if (url.pathname.startsWith("/_astro/") || url.pathname.startsWith("/vendor/")) e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then(keep)));
  else e.respondWith(fetch(e.request).then(keep).catch(() => caches.match(e.request).then((hit) => hit ?? caches.match("/"))));
});
