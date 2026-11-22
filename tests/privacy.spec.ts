// What must not survive: location data, typed text, and readable files left in browser storage.
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { test, expect, type Page } from "./fixture";

const C = (n: string) => `tests/crafted/${n}`;
const go = (page: Page) => page.locator("#panel > .btn").first();
const finished = (page: Page) => expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
const output = (page: Page) => page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes as Uint8Array; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); }).then((x) => Buffer.from(x, "base64"));
const note = (page: Page) => page.evaluate(() => (window as any).__lathe.outs[0].note as string);
const MARKS = ["ARTISTSECRET", "CAMERAMAKESECRET", "XMPSECRET", "JPEGCOMSECRET", "IPTCBYLSECRET", "TRAILERSECRET"];

test("a photo placed in a PDF carries no metadata, and the wipe removes it from older PDFs", async ({ page }) => {
  await page.goto("/images-to-pdf");
  await page.locator("#stage input[type=file]").first().setInputFiles(C("meta.jpg"));
  await expect(go(page)).toBeEnabled(); await go(page).click(); await finished(page);
  const pdf = await output(page);
  for (const m of MARKS) expect(pdf.includes(m), m).toBe(false);
});
test("the metadata wipe cleans a JPEG already inside a PDF", async ({ page }) => {
  const { PDFDocument, PDFName, PDFRawStream } = await import("pdf-lib");
  const raw = new Uint8Array(readFileSync(C("meta.jpg"))), d = await PDFDocument.create(), im = await d.embedJpg(raw); d.addPage([200, 200]).drawImage(im, { x: 0, y: 0, width: 100, height: 100 });
  const old = Buffer.from(await d.save({ useObjectStreams: false }));
  expect(old.includes("ARTISTSECRET")).toBe(true); void PDFName; void PDFRawStream;
  await page.goto("/pdf-metadata");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "old.pdf", mimeType: "application/pdf", buffer: old });
  await expect(go(page)).toBeEnabled();
  await page.evaluate(() => { (window as any).__lathe.params.wipe = true; }); await go(page).click(); await finished(page);
  const pdf = await output(page);
  for (const m of MARKS) expect(pdf.includes(m), m).toBe(false);
});
test("the metadata wipe removes comment authors and says what remains", async ({ page }) => {
  await page.goto("/pdf-metadata");
  await page.locator("#stage input[type=file]").first().setInputFiles(C("kitchen.pdf"));
  await expect(go(page)).toBeEnabled();
  await page.evaluate(() => { (window as any).__lathe.params.wipe = true; }); await go(page).click(); await finished(page);
  expect((await output(page)).includes("ANNOTAUTHORSECRET")).toBe(false);
  expect(await note(page)).toMatch(/Still in the file:.*attachments/);
});
test("editing the title leaves no stale XMP title", async ({ page }) => {
  const { PDFDocument, PDFName } = await import("pdf-lib");
  const d = await PDFDocument.create(); d.addPage([100, 100]);
  d.catalog.set(PDFName.of("Metadata"), d.context.register(d.context.stream("<x:xmpmeta>XMPOLDTITLE</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" })));
  await page.goto("/pdf-metadata");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "t.pdf", mimeType: "application/pdf", buffer: Buffer.from(await d.save({ useObjectStreams: false })) });
  await expect(go(page)).toBeEnabled();
  await page.evaluate(() => { (window as any).__lathe.params.title = "New title"; }); await go(page).click(); await finished(page);
  expect((await output(page)).includes("XMPOLDTITLE")).toBe(false);
});
test("typed text is never stored, and older stored text is removed", async ({ page }) => {
  await page.goto("/privacy");
  await page.evaluate(() => localStorage.setItem("lathe:watermark-pdf", JSON.stringify({ text: "OLD-CLIENT-NAME" })));
  await page.goto("/watermark-pdf");
  const field = page.locator("#panel input[type=text]").first();
  await expect(field).not.toHaveValue("OLD-CLIENT-NAME");
  await field.fill("CLIENT-JANE-DOE");
  await page.locator("#panel input[type=range]").first().fill("40");
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain("CLIENT-JANE-DOE"); expect(stored).not.toContain("OLD-CLIENT-NAME");
  await page.reload();
  await expect(page.locator("#panel input[type=text]").first()).not.toHaveValue("CLIENT-JANE-DOE");
});
test("a file waiting for the next tool is unreadable in storage", async ({ page }) => {
  // Records exactly what reaches IndexedDB, so the check does not depend on interrupting a navigation.
  const written: string[] = [];
  await page.exposeFunction("__recordPut", (sample: string) => { written.push(sample); });
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const parts: string[] = [];
      const walk = (v: any) => { if (v instanceof ArrayBuffer) parts.push(String.fromCharCode(...new Uint8Array(v).subarray(0, 4096))); else if (ArrayBuffer.isView(v)) parts.push(String.fromCharCode(...new Uint8Array(v.buffer).subarray(0, 4096))); else if (typeof v === "string") parts.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
      walk(value); (window as any).__recordPut(parts.join("|"));
      return put.call(this, value, key);
    };
  });
  await page.goto("/compress-image");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "passport-scan.jpg", mimeType: "image/jpeg", buffer: readFileSync("tests/fixtures/photo.jpg") });
  await expect(go(page)).toBeEnabled(); await go(page).click(); await finished(page);
  await page.locator("#panel .chips button", { hasText: "Resize" }).click();
  await expect.poll(() => written.length, { timeout: 8_000 }).toBeGreaterThan(0);
  const seen = written.join("|");
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).not.toContain("passport-scan");
  expect(seen).not.toContain("JFIF");
});
test("a file handed to the next tool still arrives intact", async ({ page }) => {
  await page.goto("/compress-image");
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/photo.jpg");
  await expect(go(page)).toBeEnabled(); await go(page).click(); await finished(page);
  await page.locator("#panel .chips button", { hasText: "Resize" }).click();
  await page.waitForURL("**/resize-image");
  await expect(page.locator(".tray .fname")).toContainText("photo");
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
test("ZIP entries cannot escape the folder they are extracted to", async ({ page }) => {
  await page.goto("/split-image");
  const bytes = [...readFileSync("tests/fixtures/photo.jpg")];
  await page.evaluate((b) => (window as any).__lathe.addFiles([new File([new Uint8Array(b)], "..\\..\\evil.jpg", { type: "image/jpeg" })]), bytes);
  await expect(go(page)).toBeEnabled(); await go(page).click(); await finished(page);
  for (const name of Object.keys(unzipSync(new Uint8Array(await output(page))))) { expect(name).not.toContain(".."); expect(name).not.toContain("\\"); expect(name.startsWith("/")).toBe(false); }
});
test("an optimised SVG cannot carry script, remote content or foreign HTML", async ({ page }) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><a><animate attributeName="href" to="javascript:alert(1)"/><rect width="5" height="5"/></a><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">HTMLSECRET</div></foreignObject><image href="https://example.com/track.png" width="1" height="1"/><circle r="2" onload="alert(2)"/></svg>`;
  await page.goto("/optimize-svg");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(go(page)).toBeEnabled(); await go(page).click(); await finished(page);
  const out = (await output(page)).toString();
  for (const bad of ["javascript:", "HTMLSECRET", "foreignObject", "example.com", "onload"]) expect(out, bad).not.toContain(bad);
  expect(out).toContain("<circle");
});
test("metadata removal does not claim a WebP had none", async ({ page }) => {
  await page.goto("/remove-metadata");
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/photo.webp");
  await expect(go(page)).toBeEnabled(); await go(page).click(); await finished(page);
  expect(await note(page)).not.toContain("No metadata found");
});
