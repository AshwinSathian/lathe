// Crafted PDFs that once kept removed content, or changed a file without saying so.
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { test, expect, type Page } from "./fixture";

const C = (n: string) => `tests/crafted/${n}`;
/** Searches the raw file and every Flate stream, which covers object streams too. */
function holds(buf: Buffer, marker: string) {
  if (buf.includes(marker)) return true;
  const re = /stream\r?\n/g; let m: RegExpExecArray | null;
  while ((m = re.exec(buf.toString("latin1")))) {
    const start = m.index + m[0].length, end = buf.indexOf("endstream", start);
    if (end < 0) break;
    try { if (inflateSync(buf.subarray(start, end), { finishFlush: 2 }).includes(marker)) return true; } catch { /* Not a Flate stream. */ }
  }
  return false;
}
async function load(page: Page, id: string, file: string) {
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(C(file));
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible();
  await expect(page.locator("#panel > .btn").first()).toBeEnabled({ timeout: 20_000 }).catch(() => {});
}
async function run(page: Page, params: object = {}) {
  await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), params);
  const go = page.locator("#panel > .btn").first(); await expect(go).toBeEnabled(); await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
  return result(page);
}
const result = (page: Page) => page.evaluate(() => { const o = (window as any).__lathe.outs[0]; if (!o) return { alert: document.querySelector("#panel .alert")?.textContent ?? "" }; let s = ""; for (let i = 0; i < o.bytes.length; i += 32768) s += String.fromCharCode(...o.bytes.subarray(i, i + 32768)); return { b64: btoa(s), note: o.note as string, type: o.type as string, alert: "" }; });
const bytes = (r: { b64?: string }) => Buffer.from(r.b64, "base64");
const parts = (r: { b64?: string; type?: string }) => r.type === "application/zip" ? Object.values(unzipSync(new Uint8Array(bytes(r)))).map((x) => Buffer.from(x)) : [bytes(r)];

const removal: [string, object][] = [["delete-pages", { pages: "1" }], ["extract-pages", { pages: "2" }], ["split-pdf", { mode: "ranges", ranges: "2" }], ["organize-pdf", { order: [{ f: 0, page: 1, rot: 0 }] }]];
for (const [id, params] of removal) {
  test(`${id} warns about reused content and can remove it`, async ({ page }) => {
    await load(page, id, "shared.pdf");
    if (id === "organize-pdf") await page.waitForFunction(() => (window as any).__lathe.params.order?.length > 0);
    const first = await run(page, params);
    expect(first.note).toContain("reuses content");
    await page.getByRole("button", { name: "Remove securely" }).click();
    await expect(page.locator("#panel .results a[download]").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#panel .results small").first()).toContainText("images");
    for (const part of parts(await result(page))) for (const secret of ["NESTEDIMGSECRET", "PATTERNSECRET"]) expect(holds(part, secret)).toBe(false);
  });
  test(`${id} removes the page the reader shows`, async ({ page }) => {
    await load(page, id, "differ.pdf");
    if (id === "organize-pdf") await page.waitForFunction(() => (window as any).__lathe.params.order?.length > 0);
    for (const part of parts(await run(page, params))) expect(holds(part, "DIFFSECRET")).toBe(false);
  });
}
test("a stray /Encrypt string cannot skip the page check", async ({ page }) => {
  const forged = Buffer.concat([readFileSync(C("differ.pdf")), Buffer.from("\n% /Encrypt\n")]);
  await page.goto("/delete-pages");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "forged.pdf", mimeType: "application/pdf", buffer: forged });
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible();
  await expect(page.locator("#panel > .btn").first()).toBeEnabled({ timeout: 20_000 });
  expect(holds(bytes(await run(page, { pages: "1" })), "DIFFSECRET")).toBe(false);
});
test("signing places the mark on the page the reader shows", async ({ page }) => {
  await page.goto("/sign-pdf");
  await page.locator("#stage input[type=file]").first().setInputFiles(C("differ.pdf"));
  await expect(page.locator(".docpage canvas").first()).toBeVisible({ timeout: 20_000 });
  const size = await page.evaluate(() => (window as any).__lathe.files?.[0]?.size ?? 0);
  expect(size).not.toBe(readFileSync(C("differ.pdf")).length);
});
test("a page tool still reports restrictions after intake", async ({ page }) => {
  await load(page, "delete-pages", "owner-only.pdf");
  expect((await run(page, { pages: "1" })).note).toContain("restrictions");
});
test("keep-text redaction removes the page the reader shows", async ({ page }) => {
  await load(page, "redact-pdf", "differ.pdf");
  const r = await run(page, { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  expect(holds(bytes(r), "DIFFSECRET")).toBe(false);
});
for (const id of ["rotate-pdf", "watermark-pdf", "page-numbers", "crop-pdf", "flatten-pdf"]) test(`${id} leaves no superseded text behind`, async ({ page }) => {
  await load(page, id, "orphan.pdf");
  expect(holds(bytes(await run(page, id === "watermark-pdf" ? { text: "DRAFT" } : {})), "ORPHANSECRET")).toBe(false);
});
test("a tool says when it invalidates a digital signature", async ({ page }) => {
  await load(page, "rotate-pdf", "signed.pdf");
  expect((await run(page)).note).toContain("digital signature");
});
test("signing warns before an existing signature is invalidated", async ({ page }) => {
  await page.goto("/sign-pdf");
  await page.locator("#stage input[type=file]").first().setInputFiles(C("signed.pdf"));
  await expect(page.locator("#panel .notice")).toContainText("digital signature");
});
for (const id of ["flatten-pdf", "fill-pdf"]) test(`${id} refuses an XFA form instead of deleting it`, async ({ page }) => {
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(C("xfa.pdf"));
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible();
  if (id === "flatten-pdf") { await page.locator("#panel > .btn").first().click(); }
  await expect(page.locator("#panel .alert")).toContainText("XFA");
});
test("page tools say what they do not carry over", async ({ page }) => {
  await load(page, "delete-pages", "outlined.pdf");
  expect((await run(page, { pages: "1" })).note).toContain("bookmarks");
});
test("a restricted PDF says its restrictions are gone", async ({ page }) => {
  await load(page, "rotate-pdf", "owner-only.pdf");
  expect((await run(page)).note).toContain("restrictions");
});
test("redaction keeps a page's physical size", async ({ page }) => {
  await load(page, "redact-pdf", "userunit.pdf");
  const d = await PDFDocument.load(bytes(await run(page, { regions: [{ page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] })));
  expect(d.getPage(0).node.get((await import("pdf-lib")).PDFName.of("UserUnit"))?.toString()).toBe("2");
});
test("keep-text redaction flattens a page sharing a comment with a redacted page", async ({ page }) => {
  await load(page, "redact-pdf", "sharedstr.pdf");
  const r = await run(page, { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 0.5, h: 0.5 }] });
  expect(holds(bytes(r), "SHAREDCOMMENTSECRET")).toBe(false);
});
