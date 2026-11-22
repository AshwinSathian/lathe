// Realistic documents that page-removal tools must not break or leak from.
import { test, expect, type Page } from "./fixture";
import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from "pdf-lib";
import sharp from "sharp";

const file = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });
async function run(page: Page, id: string, f: any, params: object = {}) {
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(f);
  await expect(page.locator("#stage .tray")).toBeVisible();
  // The organiser publishes its page order once thumbnails are laid out, which would overwrite an earlier value.
  if (id === "organize-pdf") await page.waitForFunction(() => (window as any).__lathe.params.order?.length > 0);
  await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), params);
  const go = page.locator("#panel > .btn").first(); await expect(go).toBeEnabled(); await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
  return page.evaluate(() => { const o = (window as any).__lathe.outs[0], b = o.bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return { b64: btoa(s), note: o.note as string }; }).then((x) => ({ bytes: Buffer.from(x.b64, "base64"), note: x.note }));
}
const pageObjects = (d: PDFDocument) => d.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFDict && (o.lookup(PDFName.of("Type")) as any)?.decodeText?.() === "Page").length;
async function linkedDoc() {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), pages = [1, 2, 3].map((n) => { const p = d.addPage([300, 300]); p.drawText(`Page ${n}`, { x: 20, y: 200, size: 20, font: f }); return p; });
  pages[0].node.addAnnot(d.context.register(d.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], P: pages[0].ref, Dest: [pages[1].ref, PDFName.of("Fit")] })));
  return Buffer.from(await d.save({ useObjectStreams: false }));
}
const firstLinkTarget = (d: PDFDocument) => { const a = d.getPage(0).node.Annots(); if (!a?.size()) return null; const l = a.lookup(0, PDFDict), dest: any = l.lookup(PDFName.of("Dest")); return dest?.get(0) as PDFRef; };

for (const [id, params, want] of [["extract-pages", { pages: "1-2" }, 2], ["delete-pages", { pages: "3" }, 2], ["split-pdf", { mode: "ranges", ranges: "1-2" }, 2], ["merge-pdf", {}, 6]] as const) {
  test(`${id} keeps a working link between kept pages`, async ({ page }) => {
    const input = id === "merge-pdf" ? [file("a.pdf", await linkedDoc()), file("b.pdf", await linkedDoc())] : file("a.pdf", await linkedDoc());
    const { bytes } = await run(page, id, input, params), d = await PDFDocument.load(bytes);
    expect(d.getPageCount()).toBe(want); expect(pageObjects(d)).toBe(want);
    expect(firstLinkTarget(d)?.toString()).toBe(d.getPage(1).ref.toString());
  });
}
test("organiser keeps a link when pages are reordered", async ({ page }) => {
  const { bytes } = await run(page, "organize-pdf", file("a.pdf", await linkedDoc()), { order: [{ f: 0, page: 1, rot: 0 }, { f: 0, page: 0, rot: 0 }] }), d = await PDFDocument.load(bytes);
  expect(pageObjects(d)).toBe(2);
  const a = d.getPage(1).node.Annots().lookup(0, PDFDict), dest: any = a.lookup(PDFName.of("Dest"));
  expect(dest.get(0).toString()).toBe(d.getPage(0).ref.toString());
});
test("removing a page from a real form keeps the other fields", async ({ page }) => {
  const d = await PDFDocument.create(), a = d.addPage([300, 300]), b = d.addPage([300, 300]), form = d.getForm();
  const x = form.createTextField("one"); x.setText("KEEPVALUE"); x.addToPage(a, { x: 10, y: 10, width: 100, height: 20 });
  const y = form.createTextField("two"); y.setText("GONEVALUE"); y.addToPage(b, { x: 10, y: 10, width: 100, height: 20 });
  for (const [w, p] of [[x, a], [y, b]] as const) w.acroField.getWidgets()[0].dict.set(PDFName.of("P"), p.ref);
  const { bytes } = await run(page, "delete-pages", file("form.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { pages: "2" }), o = await PDFDocument.load(bytes);
  expect(o.getPageCount()).toBe(1); expect(pageObjects(o)).toBe(1); expect(o.getPage(0).node.Annots()?.size()).toBe(1);
});
test("deleting a page removes its image from a shared resource dictionary", async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer()), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  a.drawText("KEPT", { x: 20, y: 200, size: 20, font: f }); b.drawImage(jpg, { x: 0, y: 0, width: 300, height: 300 }); await d.flush();
  const xo = b.node.Resources().get(PDFName.of("XObject")); a.node.Resources().set(PDFName.of("XObject"), xo);
  const { bytes } = await run(page, "delete-pages", file("shared.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { pages: "2" }), o = await PDFDocument.load(bytes);
  let images = 0; for (const [, x] of o.context.enumerateIndirectObjects()) if ((x as any).dict?.lookup?.(PDFName.of("Width"))?.asNumber?.() === 64) images++;
  expect(images).toBe(0);
});
test("deleting a page warns when a kept page really reuses its image", async ({ page }) => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer());
  for (let i = 0; i < 2; i++) d.addPage([300, 300]).drawImage(jpg, { x: 0, y: 0, width: 64, height: 64 });
  const { note } = await run(page, "delete-pages", file("logo.pdf", Buffer.from(await d.save())), { pages: "2" });
  expect(note).toMatch(/Redact PDF/);
});
test("redaction flattens every page by default", async ({ page }) => {
  const { bytes, note } = await run(page, "redact-pdf", file("a.pdf", await linkedDoc()), { regions: [{ page: 0, x: 0, y: 0, w: 1, h: 0.2 }] }), d = await PDFDocument.load(bytes);
  expect(d.getPageCount()).toBe(3); expect(note).toMatch(/every page/i);
  for (const p of d.getPages()) expect(p.node.Annots()?.size() ?? 0).toBe(0);
  expect(bytes.toString("latin1")).not.toMatch(/\/Font\b/);
});
test("the maximum security setting cannot stay off between visits", async ({ page }) => {
  await page.goto("/redact-pdf");
  const toggle = page.getByLabel(/Flatten every page/); await expect(toggle).toBeChecked();
  await toggle.uncheck(); await page.reload();
  await expect(page.getByLabel(/Flatten every page/)).toBeChecked();
});
