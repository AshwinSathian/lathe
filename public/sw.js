// Offline support. Hashed assets are cache-first; pages try the network, then the last copy seen.
// The build replaces this name, so a release never reuses another release's engines.
const CACHE = "lathe-dev";
// The offline notice and the tool list are saved up front. Everything else is saved as it is used.
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline", "/tools.json"])).catch(() => {}).then(() => self.skipWaiting())));
// The previous release's cache stays, so a tab left open can still load its own chunks.
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((k) => {
  // Downloaded models live in their own cache and survive releases.
  const old = k.filter((x) => x.startsWith("lathe-") && x !== CACHE && x !== "lathe-models"), keep = old.at(-1);
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
  else e.respondWith(fetch(e.request).then(keep).catch(async () => {
    const c = await caches.open(CACHE), page = e.request.mode === "navigate", hit = await c.match(e.request, { ignoreSearch: page });
    return hit ?? (page && (await c.match("/offline"))) ?? Response.error();
  }));
});
