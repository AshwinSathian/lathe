// Offline support. Hashed assets are cache-first; pages try the network, then the last copy seen.
// The build replaces this name, so a release never reuses another release's engines.
const CACHE = "lathe-dev";
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
// The previous release's cache stays, so a tab left open can still load its own chunks.
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => {
  const old = k.filter((x) => x !== CACHE), keep = old.at(-1);
  return Promise.all([...old.filter((x) => x !== keep).map((x) => caches.delete(x)), keep && pruneToChunks(keep)]);
}).then(() => self.clients.claim())));
// An old page carries its old CSP, and old engines may have known bugs, so only hashed chunks survive a release.
const pruneToChunks = async (name) => { const c = await caches.open(name); await Promise.all((await c.keys()).filter((r) => !new URL(r.url).pathname.startsWith("/_astro/")).map((r) => c.delete(r))); };
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const keep = (res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; };
  // Hashed names never change, so any cache may answer. Vendor names are reused, so only this release's cache may.
  if (url.pathname.startsWith("/_astro/")) e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then(keep)));
  else if (url.pathname.startsWith("/vendor/")) e.respondWith(caches.open(CACHE).then((c) => c.match(e.request)).then((hit) => hit ?? fetch(e.request, { cache: "no-cache" }).then(keep)));
  else e.respondWith(fetch(e.request).then(keep).catch(() => caches.open(CACHE).then((c) => c.match(e.request).then((hit) => hit ?? c.match("/")))));
});
