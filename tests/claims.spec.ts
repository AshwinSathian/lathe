// Wording that a person relies on when deciding whether a document is safe to share.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { test, expect, type Page } from "./fixture";

const go = (page: Page) => page.locator("#panel > .btn").first();
const A = "tests/fixtures/a.pdf";
async function run(page: Page, id: string, file: any, params: object = {}) {
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(file);
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible();
  await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), params);
  await expect(go(page)).toBeEnabled({ timeout: 20_000 }); await go(page).click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
  return { alert: (await page.locator("#panel .alert").allTextContents()).join(""), note: await page.evaluate(() => (window as any).__lathe.outs[0]?.note as string), b64: await page.evaluate(() => { const b = (window as any).__lathe.outs[0]?.bytes; if (!b) return ""; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); }) };
}
test("cropping says the cut area is hidden, not removed", async ({ page }) => {
  expect((await run(page, "crop-pdf", A, { top: 40 })).note).toMatch(/hidden.*not removed.*Redact PDF/i);
});
test("turning off full flatten warns that keep-text is weaker, before and after the run", async ({ page }) => {
  await page.goto("/redact-pdf");
  await page.locator("#stage input[type=file]").first().setInputFiles(A);
  await expect(go(page)).toBeEnabled({ timeout: 20_000 });
  const toggle = page.getByLabel(/Flatten every page/); await toggle.uncheck();
  await expect(page.locator("#panel .weaker")).toContainText(/weaker/i);
  await page.evaluate(() => { (window as any).__lathe.params.regions = [{ page: 0, x: 0, y: 0, w: 1, h: 0.2 }]; });
  await go(page).click();
  await expect(page.locator("#panel .results h2").first()).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__lathe.outs[0].note)).toMatch(/best effort/i);
  await toggle.check();
  await expect(page.locator("#panel .weaker")).toBeHidden();
});
for (const password of ["--help", "@/in.pdf", "-secret", "two words"]) test(`a password such as ${password} works`, async ({ page }) => {
  const r = await run(page, "protect-pdf", A, { password });
  expect(r.alert).toBe("");
  const locked = Buffer.from(r.b64, "base64");
  await expect(PDFDocument.load(locked)).rejects.toThrow();
  const u = await run(page, "unlock-pdf", { name: "l.pdf", mimeType: "application/pdf", buffer: locked }, { password });
  expect(u.alert).toBe("");
  expect((await PDFDocument.load(Buffer.from(u.b64, "base64"))).getPageCount()).toBe(5);
});
test("a damaged PDF gets a plain message, with no engine text", async ({ page }) => {
  const r = await run(page, "linearize-pdf", { name: "bad.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.7\n"), readFileSync(A).subarray(100, 300)]) });
  expect(r.alert).toMatch(/damaged/i);
  expect(r.alert).not.toMatch(/this\.program|\/in\.pdf|startxref/);
});
