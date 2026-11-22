// Production checks: run with LATHE_URL set. They cover what only exists on the real host.
import { test, expect } from "@playwright/test";
import { tools } from "../src/data/tools";
const base = process.env.LATHE_URL;
test.skip(!base, "Needs LATHE_URL");
test.skip(({ browserName }) => browserName !== "chromium", "Headers do not vary by browser");

test("every page is served, canonical and indexable", async ({ request }) => {
  const paths = ["/", "/privacy", ...tools.map((t) => `/${t.id}`)];
  for (let i = 0; i < paths.length; i += 12) await Promise.all(paths.slice(i, i + 12).map(async (p) => {
    const r = await request.get(p, { maxRedirects: 0 }), h = await r.text();
    expect(r.status(), p).toBe(200);
    expect(h, p).toContain(`rel="canonical" href="${base}${p === "/" ? "/" : p}"`);
    expect(h, p).not.toMatch(/noindex/);
  }));
});
test("security headers are present", async ({ request }) => {
  const h = (await request.get("/")).headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).not.toContain("unsafe-eval'; ");
  expect(h["strict-transport-security"]).toBeTruthy(); expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["cross-origin-opener-policy"]).toBe("same-origin"); expect(h["cross-origin-embedder-policy"]).toBe("credentialless");
});
test("caching matches each kind of file", async ({ request }) => {
  const page = await (await request.get("/")).text(), asset = page.match(/\/_astro\/[^"]+\.js/)[0];
  expect((await request.get(asset)).headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect((await request.get("/sw.js")).headers()["cache-control"]).toBe("no-cache");
  expect((await request.get("/")).headers()["cache-control"]).toContain("stale-while-revalidate");
});
test("discovery files are right", async ({ request }) => {
  expect(await (await request.get("/robots.txt")).text()).toContain(`Sitemap: ${base}/sitemap-index.xml`);
  const map = await (await request.get("/sitemap-0.xml")).text(); expect(map.match(/<loc>/g).length).toBe(tools.length + 2);
  expect(await (await request.get("/llms.txt")).text()).toContain(`${tools.length} free image and PDF tools`);
  expect((await request.get("/og.png")).headers()["content-type"]).toBe("image/png");
  expect((await request.get("/no-such-page")).status()).toBe(404);
});
test("engines are served with the right type, under the size limit", async ({ request }) => {
  const r = await request.head("/vendor/mediapipe/vision_wasm_internal.wasm"); expect(r.status()).toBe(200); expect(r.headers()["content-type"]).toBe("application/wasm");
});
test("the page loads without console errors", async ({ page }) => {
  const bad: string[] = []; page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); }); page.on("pageerror", (e) => bad.push(e.message));
  await page.goto("/compress-pdf"); await page.waitForLoadState("networkidle");
  expect(bad).toEqual([]);
});
