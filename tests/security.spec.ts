// Regression tests for ways a privacy tool can quietly keep what it promised to remove.
import { test, expect, type Page } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName, PDFOperator, PDFString, StandardFonts } from "pdf-lib";
import { inflateSync } from "node:zlib";
import sharp from "sharp";

const file = (name: string, buffer: Buffer, mimeType = "application/pdf") => ({ name, mimeType, buffer });
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
  return Buffer.from(await page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); }), "base64");
}
/** Every stream in the file, decompressed, so a secret cannot hide in an object stream. */
const plain = (b: Buffer) => { let out = b.toString("latin1"), at = 0; while ((at = b.indexOf("stream", at)) >= 0) { let s = at + 6; if (b[s] === 13) s++; if (b[s] === 10) s++; const e = b.indexOf("endstream", s); if (e < 0) break; try { out += inflateSync(b.subarray(s, e)).toString("latin1"); } catch { /* Not Flate. */ } at = e + 9; } return out; };
const stringsOf = async (d: PDFDocument) => plain(Buffer.from(await d.save({ useObjectStreams: false })));

async function linked() {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), a = d.addPage([400, 400]), b = d.addPage([400, 400]);
  a.drawText("KEEPME", { x: 40, y: 300, size: 20, font: f }); b.drawText("TOPSECRET", { x: 40, y: 300, size: 20, font: f });
  a.node.addAnnot(d.context.register(d.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], Dest: [b.ref, PDFName.of("Fit")] })));
  return Buffer.from(await d.save({ useObjectStreams: false }));
}
const hasSecret = (b: Buffer) => /544f50534543524554|TOPSECRET/i.test(plain(b));

test("fixture really does hide the secret behind a link", async () => { expect(hasSecret(await linked())).toBe(true); });
for (const [id, params] of [["redact-pdf", { flattenAll: false, regions: [{ page: 1, x: 0, y: 0, w: 1, h: 1 }] }], ["delete-pages", { pages: "2" }], ["extract-pages", { pages: "1" }], ["split-pdf", { mode: "ranges", ranges: "1" }]] as const) {
  test(`${id} leaves no removed page behind a cross-page link`, async ({ page }) => {
    const out = await run(page, id, file("linked.pdf", await linked()), params);
    expect(hasSecret(out)).toBe(false);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(id === "redact-pdf" ? 2 : 1);
  });
}
test("organiser drops a deleted page behind a link", async ({ page }) => {
  const out = await run(page, "organize-pdf", file("linked.pdf", await linked()), { order: [{ f: 0, page: 0, rot: 0 }] });
  expect(hasSecret(out)).toBe(false);
});
test("redaction flattens a kept page that lists a hidden image", async ({ page }) => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer()), f = await d.embedFont(StandardFonts.Helvetica);
  const a = d.addPage([300, 300]), b = d.addPage([300, 300]); a.drawImage(jpg, { x: 0, y: 0, width: 300, height: 300 }); b.drawText("KEPT", { x: 20, y: 200, size: 20, font: f });
  await d.flush();
  const name = a.node.Resources().lookup(PDFName.of("XObject"), PDFDict).keys()[0];
  b.node.Resources().set(PDFName.of("XObject"), d.context.obj({ [name.decodeText()]: jpg.ref }));
  const out = await run(page, "redact-pdf", file("shared.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  const o = await PDFDocument.load(out); let same = 0;
  for (const [, x] of o.context.enumerateIndirectObjects()) if ((x as any).dict?.lookup?.(PDFName.of("Width"))?.asNumber?.() === 64) same++;
  expect(same).toBe(0);
});
test("redaction flattens a kept page that draws part of a shared image", async ({ page }) => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer()), f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) { const p = d.addPage([300, 300]); p.drawImage(jpg, { x: 0, y: 0, width: 64, height: 64 }); p.drawText("KEPT", { x: 20, y: 200, size: 20, font: f }); }
  const out = await run(page, "redact-pdf", file("logo.pdf", Buffer.from(await d.save())), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  const o = await PDFDocument.load(out); let same = 0;
  for (const [, x] of o.context.enumerateIndirectObjects()) if ((x as any).dict?.lookup?.(PDFName.of("Width"))?.asNumber?.() === 64) same++;
  expect(same).toBe(0); expect(o.getPageCount()).toBe(2);
});
test("metadata wipe removes private data held in a separate stream", async ({ page }) => {
  const d = await PDFDocument.create(), p = d.addPage([200, 200]), priv = d.context.register(d.context.stream("HIDDENPRIVATE", {}));
  p.node.set(PDFName.of("PieceInfo"), d.context.obj({ App: { Private: priv } }));
  const out = await run(page, "pdf-metadata", file("m.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { wipe: true });
  expect(plain(out)).not.toContain("HIDDENPRIVATE"); expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
});
test("redaction flattens a kept page whose form reaches a hidden image", async ({ page }) => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer());
  const a = d.addPage([300, 300]), b = d.addPage([300, 300]); a.drawImage(jpg, { x: 0, y: 0, width: 300, height: 300 }); await d.flush();
  const form = d.context.register(d.context.stream("q Q", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10], Resources: { XObject: { Hidden: jpg.ref } } }));
  b.node.Resources().set(PDFName.of("XObject"), d.context.obj({ Wrap: form }));
  b.pushOperators(PDFOperator.of("Do" as any, [PDFName.of("Wrap")]));
  const out = await run(page, "redact-pdf", file("nested.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  const o = await PDFDocument.load(out); let same = 0;
  for (const [, x] of o.context.enumerateIndirectObjects()) if ((x as any).dict?.lookup?.(PDFName.of("Width"))?.asNumber?.() === 64) same++;
  expect(same).toBe(0);
});
test("removing a page drops its form field values from kept pages", async ({ page }) => {
  const d = await PDFDocument.create(), a = d.addPage([300, 300]), b = d.addPage([300, 300]), form = d.getForm(), f = form.createTextField("shared");
  f.setText("HIDDENVALUE"); f.addToPage(a, { x: 10, y: 10, width: 100, height: 20 }); f.addToPage(b, { x: 10, y: 10, width: 100, height: 20 });
  for (const w of f.acroField.getWidgets()) w.dict.delete(PDFName.of("P"));
  const src = Buffer.from(await d.save({ useObjectStreams: false }));
  const out = await run(page, "delete-pages", file("field.pdf", src), { pages: "2" });
  expect(plain(out)).not.toContain("HIDDENVALUE"); expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
});
test("a crafted Markdown link cannot inject PDF objects", async ({ page }) => {
  const md = "[click](https://example.com/a)/S/JavaScript/JS(app.alert(1))>>) and [bad](javascript:alert(1))\n";
  const out = await run(page, "markdown-to-pdf", file("x.md", Buffer.from(md), "text/markdown"));
  const s = plain(out); expect(s).not.toMatch(/\/S\s*\/JavaScript/); expect(s).not.toMatch(/javascript:/i);
  const d = await PDFDocument.load(out); expect(d.getPageCount()).toBe(1);
});
test("redaction flattens a kept page that reuses the redacted page's content stream", async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  a.drawText("TOPSECRET", { x: 20, y: 200, size: 20, font: f }); await d.flush();
  b.node.set(PDFName.of("Contents"), a.node.get(PDFName.of("Contents"))); b.node.set(PDFName.of("Resources"), a.node.get(PDFName.of("Resources")));
  const out = await run(page, "redact-pdf", file("same.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  expect(hasSecret(out)).toBe(false);
});
test("redaction flattens a kept page that shares an annotation appearance", async ({ page }) => {
  const d = await PDFDocument.create(), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  const look = d.context.register(d.context.stream("BT (HIDDENAP) Tj ET", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 50, 50] }));
  for (const p of [a, b]) p.node.addAnnot(d.context.register(d.context.obj({ Type: "Annot", Subtype: "Stamp", Rect: [0, 0, 50, 50], AP: { N: look } })));
  const out = await run(page, "redact-pdf", file("ap.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  expect(plain(out)).not.toContain("HIDDENAP");
});
test("redaction flattens a kept page that shares a Type 3 font", async ({ page }) => {
  const d = await PDFDocument.create(), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  const glyph = d.context.register(d.context.stream("0 0 d0 (HIDDENGLYPH) pop", {}));
  const font = d.context.register(d.context.obj({ Type: "Font", Subtype: "Type3", FontBBox: [0, 0, 10, 10], FontMatrix: [1, 0, 0, 1, 0, 0], CharProcs: { a: glyph }, Encoding: { Type: "Encoding", Differences: [97, PDFName.of("a")] }, FirstChar: 97, LastChar: 97, Widths: [10] }));
  for (const p of [a, b]) p.node.Resources().set(PDFName.of("Font"), d.context.obj({ T3: font }));
  const out = await run(page, "redact-pdf", file("t3.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  expect(plain(out)).not.toContain("HIDDENGLYPH");
});
test("redaction keeps pages selectable when they share only an ordinary font", async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  for (const x of ["TOPSECRET", "KEPT"]) d.addPage([300, 300]).drawText(x, { x: 20, y: 200, size: 20, font: f });
  const out = await run(page, "redact-pdf", file("font.pdf", Buffer.from(await d.save())), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  expect(hasSecret(out)).toBe(false); expect(plain(out)).toMatch(/4b455054/i);
});
for (const name of ["P", "Parent", "Metadata", "ColorSpace"]) test(`redaction is not fooled by a shared image stored under the name /${name}`, async ({ page }) => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer()), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  await d.flush();
  for (const p of [a, b]) p.node.Resources().set(PDFName.of("XObject"), d.context.obj({ [name]: jpg.ref }));
  const out = await run(page, "redact-pdf", file("named.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  const o = await PDFDocument.load(out); let same = 0;
  for (const [, x] of o.context.enumerateIndirectObjects()) if ((x as any).dict?.lookup?.(PDFName.of("Width"))?.asNumber?.() === 64) same++;
  expect(same).toBe(0);
});
for (const [label, wrap] of [["a font", { Type: "Font", Subtype: "TrueType", BaseFont: "Fake" }], ["a page tree node", { Type: "Pages", Count: 0 }], ["a page", { Type: "Page" }]] as const) test(`redaction is not fooled by a hidden image inside a dictionary labelled as ${label}`, async ({ page }) => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer()), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  a.drawImage(jpg, { x: 0, y: 0, width: 300, height: 300 }); await d.flush();
  const fake = d.context.register(d.context.obj({ ...wrap, Extra: jpg.ref }));
  b.node.Resources().set(PDFName.of("Properties"), d.context.obj({ MC0: fake }));
  const out = await run(page, "redact-pdf", file("fake.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  const o = await PDFDocument.load(out); let same = 0;
  for (const [, x] of o.context.enumerateIndirectObjects()) if ((x as any).dict?.lookup?.(PDFName.of("Width"))?.asNumber?.() === 64) same++;
  expect(same).toBe(0);
});
const redactedImageCount = async (page: Page, d: PDFDocument, name: string) => {
  const out = await run(page, "redact-pdf", file(name, Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  const o = await PDFDocument.load(out); let same = 0;
  for (const [, x] of o.context.enumerateIndirectObjects()) if ((x as any).dict?.lookup?.(PDFName.of("Width"))?.asNumber?.() === 64) same++;
  return same;
};
const twoPages = async () => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer()), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  a.drawImage(jpg, { x: 0, y: 0, width: 300, height: 300 }); await d.flush();
  return { d, jpg, a, b };
};
test("redaction is not fooled by a forged /Parent that wraps the hidden image", async ({ page }) => {
  const { d, jpg, b } = await twoPages();
  const wrapper = d.context.register(d.context.obj({ Type: "Pages", Kids: [], Count: 0, Extra: jpg.ref }));
  b.node.Resources().set(PDFName.of("Properties"), d.context.obj({ MC0: wrapper }));
  b.node.set(PDFName.of("Parent"), wrapper);
  expect(await redactedImageCount(page, d, "forged.pdf")).toBe(0);
});
test("redaction is not fooled by an XObject map labelled as a font", async ({ page }) => {
  const { d, jpg, a, b } = await twoPages();
  const map = a.node.Resources().lookup(PDFName.of("XObject"), PDFDict);
  map.set(PDFName.of("Type"), PDFName.of("Font")); map.set(PDFName.of("Subtype"), PDFName.of("TrueType"));
  b.node.Resources().set(PDFName.of("Properties"), d.context.obj({ MC0: jpg.ref }));
  expect(await redactedImageCount(page, d, "label.pdf")).toBe(0);
});
test("redaction is not fooled by an image disguised as an ICC colour space", async ({ page }) => {
  const d = await PDFDocument.create(), jpg = await d.embedJpg(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).jpeg().toBuffer()), a = d.addPage([300, 300]), b = d.addPage([300, 300]);
  await d.flush();
  a.node.Resources().set(PDFName.of("Properties"), d.context.obj({ X: [PDFName.of("ICCBased"), jpg.ref] }));
  b.node.Resources().set(PDFName.of("Properties"), d.context.obj({ Y: jpg.ref }));
  expect(await redactedImageCount(page, d, "icc-fake.pdf")).toBe(0);
});
test("redaction keeps pages selectable when they share only a colour profile", async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), icc = new Uint8Array(128); icc.set([0x61, 0x63, 0x73, 0x70], 36);
  const profile = d.context.register(d.context.stream(icc, { N: 3 }));
  for (const x of ["TOPSECRET", "KEPT"]) { const p = d.addPage([300, 300]); p.drawText(x, { x: 20, y: 200, size: 20, font: f }); p.node.Resources().set(PDFName.of("ColorSpace"), d.context.obj({ CS0: [PDFName.of("ICCBased"), profile] })); }
  const out = await run(page, "redact-pdf", file("icc.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] });
  expect(hasSecret(out)).toBe(false); expect(plain(out)).toMatch(/4b455054/i);
});
test("metadata wipe reaches XMP on pages and images", async ({ page }) => {
  const d = await PDFDocument.create(), p = d.addPage([200, 200]), xmp = d.context.register(d.context.stream("<x:xmpmeta>HIDDENNAME</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" }));
  p.node.set(PDFName.of("Metadata"), xmp); p.node.set(PDFName.of("PieceInfo"), d.context.obj({ App: { Private: PDFString.of("HIDDENNAME") } }));
  d.catalog.set(PDFName.of("Metadata"), xmp);
  const out = await run(page, "pdf-metadata", file("m.pdf", Buffer.from(await d.save({ useObjectStreams: false }))), { wipe: true });
  expect(await stringsOf(await PDFDocument.load(out))).not.toContain("HIDDENNAME");
});
test("JPEG metadata removal drops appended data and markers between scans", async ({ page }) => {
  const base = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#369" } }).jpeg({ progressive: true }).toBuffer();
  const sos = base.indexOf(Buffer.from([0xff, 0xda])), next = base.indexOf(Buffer.from([0xff, 0xda]), sos + 2);
  expect(next).toBeGreaterThan(sos);
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 12]), Buffer.from("HIDDENGPS\0")]);
  const input = Buffer.concat([base.subarray(0, next), comment, base.subarray(next), Buffer.from("HIDDENTRAILER")]);
  const out = await run(page, "remove-metadata", file("p.jpg", input, "image/jpeg"));
  const s = out.toString("latin1"); expect(s).not.toContain("HIDDENGPS"); expect(s).not.toContain("HIDDENTRAILER");
  const m = await sharp(out).metadata(); expect([m.width, m.height]).toEqual([64, 64]);
  expect(out[out.length - 2]).toBe(0xff); expect(out[out.length - 1]).toBe(0xd9);
});
test("PNG metadata removal drops unknown chunks and data after IEND", async ({ page }) => {
  const base = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#369" } }).png().toBuffer(), body = Buffer.from("caNvHIDDENCHUNK");
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length - 4);
  const input = Buffer.concat([base.subarray(0, 33), len, body, Buffer.alloc(4), base.subarray(33), Buffer.from("HIDDENTRAILER")]);
  const out = await run(page, "remove-metadata", file("p.png", input, "image/png"));
  const s = out.toString("latin1"); expect(s).not.toContain("HIDDENCHUNK"); expect(s).not.toContain("HIDDENTRAILER");
  expect((await sharp(out).metadata()).width).toBe(16);
});
test("a file is not stored until a tool is chosen, and leftovers are removed", async ({ page }) => {
  const stored = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("lathe", 1); r.onupgradeneeded = () => r.result.createObjectStore("handoff"); r.onsuccess = () => { const g = r.result.transaction("handoff").objectStore("handoff").get("files"); g.onsuccess = () => { r.result.close(); res(!!g.result); }; }; }));
  await page.goto("/"); await page.locator("#home-input").setInputFiles("tests/fixtures/a.pdf");
  await expect(page.locator("#route .chip").first()).toBeVisible();
  expect(await stored()).toBe(false);
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("lathe", 1); r.onsuccess = () => { const t = r.result.transaction("handoff", "readwrite"); t.objectStore("handoff").put([{ name: "left.pdf", type: "application/pdf", lastModified: 0, data: new ArrayBuffer(8) }], "files"); t.oncomplete = () => { r.result.close(); res(0); }; }; }));
  await page.goto("/privacy");
  await expect.poll(stored).toBe(false);
});
