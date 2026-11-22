// Output must show what the input showed. These use files that once came out damaged.
import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import sharp from "sharp";
import { test, expect, type Page } from "./fixture";

const C = (n: string) => `tests/crafted/${n}`;
const pdf = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });
async function run(page: Page, id: string, files: any, params: object = {}) {
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(files);
  await expect(page.locator("#stage .tray")).toBeVisible();
  await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), params);
  const go = page.locator("#panel > .btn").first(); await expect(go).toBeEnabled({ timeout: 20_000 }); await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 90_000 });
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
  const o = await page.evaluate(() => { const o = (window as any).__lathe.outs[0], b = o.bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return { b64: btoa(s), note: o.note as string }; });
  return { bytes: Buffer.from(o.b64, "base64"), note: o.note };
}
/** Text items with positions, read by PDF.js in the page. */
const words = (page: Page, b: Buffer) => page.evaluate(async (b64) => {
  const pdfjs: any = await import(/* @vite-ignore */ (performance.getEntriesByType("resource") as any[]).map((r) => r.name).find((n) => /\/pdf[-.][^/]*\.js$/.test(n) && !/worker/.test(n)) ?? "");
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), doc = await pdfjs.getDocument({ data }).promise, out: { s: string; on: boolean }[] = [];
  for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }); for (const it of (await pg.getTextContent()).items as any[]) if (it.str?.trim()) { const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]); out.push({ s: it.str.trim(), on: x >= -1 && y >= -1 && x <= vp.width + 1 && y <= vp.height + 1 }); } }
  return out;
}, b.toString("base64"));
const firstImage = (d: PDFDocument, i: number) => { const xo = d.getPage(i).node.Resources().lookup(PDFName.of("XObject"), PDFDict), key = xo.keys()[0]; return d.context.lookup(xo.get(key) as PDFRef) as PDFRawStream; };

test("compression leaves images it cannot safely re-encode untouched", async ({ page }) => {
  const input = await PDFDocument.load(readFileSync(C("colourspaces.pdf")));
  const { bytes } = await run(page, "compress-pdf", C("colourspaces.pdf"), { level: "small" }), d = await PDFDocument.load(bytes);
  for (const i of [0, 1, 2, 3]) {
    const a = firstImage(input, i), z = firstImage(d, i);
    expect(z.contents.length, `page ${i}`).toBe(a.contents.length);
    expect(String(z.dict.get(PDFName.of("Decode")) ?? ""), `page ${i}`).toBe(String(a.dict.get(PDFName.of("Decode")) ?? ""));
    expect(z.dict.lookup(PDFName.of("ColorSpace")) instanceof PDFArray).toBe(a.dict.lookup(PDFName.of("ColorSpace")) instanceof PDFArray);
  }
  expect((firstImage(d, 4).dict.lookup(PDFName.of("ColorSpace")) as PDFArray).lookup(0)).toBe(PDFName.of("ICCBased"));
  // A premultiplied image must stay the same size as its mask.
  expect(firstImage(d, 6).dict.lookup(PDFName.of("Width")).toString()).toBe("220");
});
test("compression keeps the resolution an image is drawn at", async ({ page }) => {
  const d = await PDFDocument.create(), raw = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#888" }, }).composite([{ input: await sharp(Buffer.alloc(600 * 600 * 3).map(() => Math.random() * 255), { raw: { width: 600, height: 600, channels: 3 } }).png().toBuffer() }]).jpeg({ quality: 95 }).toBuffer();
  d.addPage([200, 200]).drawImage(await d.embedJpg(new Uint8Array(raw)), { x: -200, y: -200, width: 600, height: 600 });
  const { bytes } = await run(page, "compress-pdf", pdf("zoomed.pdf", Buffer.from(await d.save())), { level: "balanced" });
  expect(firstImage(await PDFDocument.load(bytes), 0).dict.lookup(PDFName.of("Width")).toString()).toBe("600");
});
for (const file of ["geo_r90_crop.pdf", "geo_r180_crop.pdf"]) for (const [id, params] of [["resize-pdf", { size: "a4" }], ["n-up-pdf", { n: "2" }], ["booklet-pdf", {}]] as const) test(`${id} keeps every word of ${file} on the sheet`, async ({ page }) => {
  await page.goto("/privacy"); await page.goto(`/${id}`);
  const { bytes } = await run(page, id, C(file), params), source = await words(page, readFileSync(C(file))), got = await words(page, bytes);
  const visible = source.filter((w) => w.on).map((w) => w.s);
  expect(visible.length).toBeGreaterThan(0);
  for (const w of visible) expect(got.find((x) => x.s === w)?.on, w).toBe(true);
});
test("resizing keeps filled form values visible", async ({ page }) => {
  const d = await PDFDocument.create(), pg = d.addPage([400, 400]), f = d.getForm().createTextField("name"); f.setText("Original Value"); f.addToPage(pg, { x: 40, y: 200, width: 200, height: 30 });
  const { bytes } = await run(page, "resize-pdf", pdf("form.pdf", Buffer.from(await d.save())), { size: "a4" });
  expect((await words(page, bytes)).map((w) => w.s).join(" ")).toContain("Original Value");
});
test("blank removal removes only pages with no marks and names them", async ({ page }) => {
  const { bytes, note } = await run(page, "delete-pages", C("sparse.pdf"), { blank: true });
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(4);
  expect(note).toMatch(/page 5|pages? .*5/i);
});
test("flatten keeps hidden annotations hidden and keeps what it cannot bake in", async ({ page }) => {
  const { bytes, note } = await run(page, "flatten-pdf", C("annots2.pdf")), text = (await words(page, bytes)).map((w) => w.s).join(" ");
  expect(text).not.toContain("HIDDEN-ANNOT-TEXT"); expect(text).toContain("VISIBLE-ANNOT-TEXT");
  expect((await PDFDocument.load(bytes)).getPage(0).node.Annots()?.size()).toBe(1);
  expect(note).toMatch(/1 annotation/);
});
test("a PNG placed in a PDF stays lossless", async ({ page }) => {
  const { bytes } = await run(page, "images-to-pdf", "tests/fixtures/photo.png");
  expect(firstImage(await PDFDocument.load(bytes), 0).dict.lookup(PDFName.of("Filter"))).not.toBe(PDFName.of("DCTDecode"));
});
test("a wide-gamut JPEG keeps its colour profile in a PDF", async ({ page }) => {
  const jpg = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#e63c28" } }).withIccProfile("p3").jpeg().toBuffer();
  const { bytes } = await run(page, "images-to-pdf", { name: "p3.jpg", mimeType: "image/jpeg", buffer: jpg });
  const cs = firstImage(await PDFDocument.load(bytes), 0).dict.lookup(PDFName.of("ColorSpace"));
  expect(cs instanceof PDFArray && cs.lookup(0) === PDFName.of("ICCBased")).toBe(true);
});
test("compare reports a faint text change", async ({ page }) => {
  const { note } = await run(page, "compare-pdf", [C("cmp_faint_a.pdf"), C("cmp_faint_b.pdf")]);
  expect(note).toMatch(/Differences on page 1/);
});
test("compare never claims two files are identical", async ({ page }) => {
  const { note } = await run(page, "compare-pdf", [C("sparse.pdf"), C("sparse.pdf")]);
  expect(note).not.toMatch(/^No visual differences/); expect(note).toMatch(/dpi/i);
});
for (const file of ["dmg_noxref.pdf", "dmg_badoffset.pdf"]) test(`repair recovers ${file} and reports its pages`, async ({ page }) => {
  const { bytes, note } = await run(page, "repair-pdf", C(file)), n = (await PDFDocument.load(bytes)).getPageCount();
  expect(n).toBeGreaterThan(0); expect(note).toContain(`${n} page`);
});

const hiddenField = async () => {
  const d = await PDFDocument.create(), pg = d.addPage([400, 400]), f = d.getForm().createTextField("secret"); f.setText("HIDDENFIELDVALUE"); f.addToPage(pg, { x: 40, y: 200, width: 200, height: 30 });
  f.acroField.getWidgets()[0].dict.set(PDFName.of("F"), d.context.obj(2));
  return Buffer.from(await d.save());
};
test("flatten does not reveal a hidden form field", async ({ page }) => {
  const { bytes } = await run(page, "flatten-pdf", pdf("hidden.pdf", await hiddenField()));
  expect((await words(page, bytes)).map((w) => w.s).join(" ")).not.toContain("HIDDENFIELDVALUE");
});
test("fill and flatten does not reveal a hidden form field", async ({ page }) => {
  await page.goto("/fill-pdf");
  await page.locator("#stage input[type=file]").first().setInputFiles(pdf("hidden.pdf", await hiddenField()));
  await expect(page.locator("#panel > .btn").first()).toBeEnabled({ timeout: 20_000 });
  await page.evaluate(() => { (window as any).__lathe.params.flatten = true; });
  await page.locator("#panel > .btn").first().click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 30_000 });
  const b64 = await page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); });
  expect((await words(page, Buffer.from(b64, "base64"))).map((w) => w.s).join(" ")).not.toContain("HIDDENFIELDVALUE");
});
for (const [id, params] of [["flatten-pdf", {}], ["resize-pdf", { size: "a4" }], ["n-up-pdf", { n: "2" }], ["booklet-pdf", {}]] as const) test(`${id} does not reveal an annotation on a hidden layer`, async ({ page }) => {
  const { bytes } = await run(page, id, C("oc-annot.pdf"), params);
  expect((await words(page, bytes)).map((w) => w.s).join(" ")).not.toContain("VISIBLE-ANNOT-TEXT");
});

for (const [id, params] of [["resize-pdf", { size: "a4" }], ["n-up-pdf", { n: "2" }], ["booklet-pdf", {}]] as const) test(`${id} keeps a hidden layer hidden`, async ({ page }) => {
  const { bytes, note } = await run(page, id, C("hidden-layer.pdf"), params);
  expect((await words(page, bytes)).map((w) => w.s).join(" ")).not.toContain("LAYERSECRET");
  expect(bytes.includes("LAYERSECRET")).toBe(false);
  expect(note).toMatch(/layers/i);
});
for (const file of ["oc-usage.pdf", "oc-malformed.pdf"]) test(`flatten does not bake in an annotation whose visibility is unclear (${file})`, async ({ page }) => {
  const { bytes, note } = await run(page, "flatten-pdf", C(file));
  // The layered annotation stays an annotation, so its text is not part of the page content.
  expect((await words(page, bytes)).map((w) => w.s).join(" ")).not.toContain("VISIBLE-ANNOT-TEXT");
  expect((await PDFDocument.load(bytes)).getPage(0).node.Annots()?.size()).toBe(2);
  expect(note).toMatch(/2 annotations/);
});
test("flatten removes a hidden field's value from the file", async ({ page }) => {
  const d = await PDFDocument.load(await hiddenField()), f = d.getForm().getTextField("secret");
  d.catalog.set(PDFName.of("StructTreeRoot"), d.context.register(d.context.obj({ Type: "StructTreeRoot", K: d.context.obj({ Type: "OBJR", Obj: d.context.getObjectRef(f.acroField.getWidgets()[0].dict) ?? f.acroField.ref }) })));
  const { bytes } = await run(page, "flatten-pdf", pdf("tagged.pdf", Buffer.from(await d.save({ useObjectStreams: false }))));
  const { inflateSync } = await import("node:zlib"), text = bytes.toString("latin1"); let found = bytes.includes("HIDDENFIELDVALUE");
  for (const m of text.matchAll(/stream\r?\n/g)) { const at = m.index + m[0].length, end = bytes.indexOf("endstream", at); try { found ||= inflateSync(bytes.subarray(at, end), { finishFlush: 2 }).includes("HIDDENFIELDVALUE"); } catch { /* Not Flate. */ } }
  expect(found).toBe(false);
  // The value can also be hex-encoded or live in an appearance stream, so a dropped widget must keep neither.
  const out = await PDFDocument.load(bytes);
  for (const [, o] of out.context.enumerateIndirectObjects()) if (o instanceof PDFDict && o.lookup(PDFName.of("Subtype")) === PDFName.of("Widget")) for (const k of ["AP", "V", "DV", "RV", "MK", "Contents"]) expect(o.has(PDFName.of(k)), k).toBe(false);
});
