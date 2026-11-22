// Damaged input must end in a result or a clear message, and accessibility must hold on every page.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixture";
import { tools } from "../src/data/tools";

/** A small seeded generator, so a failure can be reproduced exactly. */
const random = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
function mutate(src: Buffer, seed: number) {
  const r = random(seed), b = Buffer.from(src), mode = seed % 3;
  if (mode === 0) for (let i = 0; i < 40; i++) b[Math.floor(r() * b.length)] = Math.floor(r() * 256);
  if (mode === 1) return b.subarray(0, Math.floor(b.length * (0.2 + r() * 0.7)));
  if (mode === 2) { const at = Math.floor(r() * b.length), n = Math.min(4096, b.length - at); b.fill(0xff, at, at + n); }
  return b;
}
const CASES: [string, string, string, string][] = [["rotate-pdf", "a.pdf", "application/pdf", "pdf"], ["delete-pages", "a.pdf", "application/pdf", "pdf"], ["compress-image", "photo.jpg", "image/jpeg", "jpg"], ["convert-image", "photo.png", "image/png", "png"], ["convert-image", "photo.webp", "image/webp", "webp"], ["convert-image", "photo.tiff", "image/tiff", "tif"], ["convert-image", "photo.gif", "image/gif", "gif"], ["heic-to-png", "photo.heic", "image/heic", "heic"]];
async function settle(page: Page) {
  const go = page.locator("#panel > .btn").first();
  // Either the file opened or was explained in the editor, or it was refused with a visible reason. Silence fails.
  await expect.poll(() => page.evaluate(() => !(window as any).__lathe.busy && !document.querySelector("#stage .view")?.textContent?.includes("Opening") && (!!document.querySelector("#stage .view") || !!document.querySelector("#panel .notice:not([hidden])")?.textContent)), { timeout: 20_000 }).toBe(true);
  if (await go.isEnabled()) { await page.evaluate(() => { const p = (window as any).__lathe.params; if ("pages" in p) p.pages = "1"; }); await go.click(); await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 30_000 }); }
}
for (const [id, file, mimeType, ext] of CASES) test(`${id} survives damaged ${ext} files`, async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One engine is enough for seeded damage");
  test.setTimeout(240_000);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  const src = readFileSync(`tests/fixtures/${file}`);
  for (let seed = 1; seed <= 6; seed++) {
    await page.goto(`/${id}`);
    await page.locator("#stage input[type=file]").first().setInputFiles({ name: `damaged.${ext}`, mimeType, buffer: mutate(src, seed * 7919) });
    await settle(page);
    const alert = (await page.locator("#panel .alert").allTextContents()).join("");
    expect(alert, `seed ${seed}`).not.toMatch(/this\.program|undefined|is not a function|out of bounds/i);
  }
  expect(errors).toEqual([]);
});
test("every page passes axe", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One engine is enough");
  test.setTimeout(600_000);
  const bad: string[] = [];
  for (const path of ["/", "/privacy", ...tools.map((t) => `/${t.id}`)]) {
    await page.goto(path);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    bad.push(...r.violations.map((v) => `${path}: ${v.id}`));
  }
  expect(bad).toEqual([]);
});
for (const [name, id, file] of [["result", "compress-image", "photo.jpg"], ["redact editor", "redact-pdf", "a.pdf"], ["sign editor", "sign-pdf", "a.pdf"], ["organise editor", "organize-pdf", "a.pdf"], ["crop editor", "crop-image", "photo.jpg"]] as const) test(`axe passes in the ${name} state`, async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One engine is enough");
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(`tests/fixtures/${file}`);
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(700);
  if (name === "result") { await page.locator("#panel > .btn").first().click(); await page.locator("#panel .results a[download]").first().waitFor({ timeout: 30_000 }); }
  if (name === "redact editor") { await page.getByRole("button", { name: "Add box on page 1" }).click(); await page.waitForTimeout(150); }
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
});
test("a PDF made by Chrome loses marked and hidden text when redacted", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium", "Only Chromium can print to PDF here");
  const maker = await context.newPage();
  await maker.setContent(`<h1>CHROMEPUBLIC heading</h1><p style="margin-top:500px">CHROMESECRET account number</p>`);
  const pdf = await maker.pdf({ format: "A4" }); await maker.close();
  for (const flattenAll of [true, false]) {
    await page.goto("/redact-pdf");
    await page.locator("#stage input[type=file]").first().setInputFiles({ name: "chrome.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(page.locator(".docpage canvas").first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate((f) => Object.assign((window as any).__lathe.params, { flattenAll: f, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] }), flattenAll);
    await page.locator("#panel > .btn").first().click();
    await page.locator("#panel .results a[download]").first().waitFor({ timeout: 60_000 });
    const text = await page.evaluate(async () => { const b = (window as any).__lathe.outs[0].bytes as Uint8Array; let s = ""; for (const x of b) s += String.fromCharCode(x); return s; });
    expect(text).not.toContain("CHROMESECRET");
  }
});
