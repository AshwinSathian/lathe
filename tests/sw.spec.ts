// Serves the built site with a changing release, so cache behaviour is tested across real updates.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { expect, test } from "./fixture";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

test("the built service worker names its cache after the build", () => {
  expect(readFileSync("dist/sw.js", "utf8")).toMatch(/const CACHE = "lathe-[0-9a-f]{12}"/);
});

test("updates replace engines and keep only two caches", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Service worker control is reliable in Chromium");
  let release = 1;
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const send = (body: string | Buffer, type: string) => { res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
    if (path === "/vendor/probe.js") return send(`release ${release}`, "text/javascript");
    if (path === "/sw.js") return send(readFileSync("dist/sw.js", "utf8").replace(/const CACHE = "[^"]+"/, `const CACHE = "lathe-r${release}"`), "text/javascript");
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, ""), candidates = [join("dist", rel), join("dist", `${rel}.html`), join("dist", rel, "index.html")];
    const file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
    if (!file) { res.writeHead(404); return res.end(); }
    send(readFileSync(file), TYPES[extname(file)] ?? "application/octet-stream");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (release = 1; release <= 4; release++) {
      await page.goto(`${base}/compress-image`);
      await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        await reg.update().catch(() => { /* A navigation may already be checking for the update. */ });
        for (let i = 0; i < 200 && (reg.installing || reg.waiting || reg.active?.state !== "activated"); i++) await new Promise((r) => setTimeout(r, 50));
      });
      await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
      expect(await page.evaluate(() => fetch("/vendor/probe.js").then((r) => r.text()))).toBe(`release ${release}`);
      expect((await page.evaluate(() => caches.keys())).length).toBeLessThanOrEqual(2);
    }
  } finally { server.close(); }
});
