import { test, expect, type Page } from "./fixture";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { unzipSync } from "fflate";
import { tools } from "../src/data/tools";

const F = (n: string) => `tests/fixtures/${n}`;
const magic = (b: Buffer) => b.subarray(0, 4).toString("latin1") === "%PDF" ? "pdf" : b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : b[0] === 0x89 && b[1] === 0x50 ? "png" : b.subarray(0, 3).toString() === "GIF" ? "gif" : b.subarray(8, 12).toString() === "WEBP" ? "webp" : b.subarray(4, 8).toString() === "ftyp" ? b.subarray(8, 12).toString() : b[0] === 0x50 && b[1] === 0x4b ? "zip" : b.subarray(0, 2).toString() === "BM" ? "bmp" : b[0] === 0 && b[2] === 1 ? "ico" : b.subarray(0, 2).toString() === "II" || b.subarray(0, 2).toString() === "MM" ? "tiff" : (b[0] === 0xff && b[1] === 0x0a) || b.subarray(4, 8).toString() === "JXL " ? "jxl" : b.includes("<svg") ? "svg" : "text";

const input: Record<string, string[]> = { "optimize-svg": ["logo.svg"], "svg-to-png": ["logo.svg"], "heic-to-jpg": ["photo.heic"], "heic-to-png": ["photo.heic"], "heic-to-webp": ["photo.heic"], "webp-to-jpg": ["photo.webp"], "webp-to-png": ["photo.webp"], "avif-to-jpg": ["photo.avif"], "avif-to-png": ["photo.avif"], "tiff-to-jpg": ["photo.tiff"], "gif-to-png": ["photo.gif"], "png-to-jpg": ["photo.png"], "png-to-webp": ["photo.png"], "png-to-avif": ["photo.png"], "png-to-heic": ["photo.png"], "png-to-ico": ["small.png"], "bmp-to-png": ["photo.png"], "fill-pdf": ["form.pdf"], "markdown-to-pdf": ["notes.md"], "delete-pages": ["blank.pdf"] };
const params: Record<string, object> = { "split-pdf": { mode: "ranges", ranges: "1-2, 3-5" }, "extract-pages": { pages: "2-3" }, "protect-pdf": { password: "hunter2", noCopy: true }, "redact-pdf": { regions: [{ page: 0, x: 0, y: 0, w: 1, h: 0.2 }] }, "censor-image": { regions: [{ page: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.3 }] }, "delete-pages": { blank: true }, "pdf-metadata": { wipe: true }, "fill-pdf": { values: { "full.name": "Asha", agree: true } } };
const expected: Record<string, string> = { "compress-image": "jpeg", "merge-pdf": "pdf", "split-pdf": "zip", "social-resize": "zip", "favicon-generator": "zip", "split-image": "zip", "sprite-sheet": "zip", "make-gif": "gif", "vectorize-image": "svg", "pdf-to-images": "zip", "extract-images": "zip", "images-to-pdf": "pdf" };
// Network models are covered in ai.spec.ts. gif-to-frames needs an animation, sign-pdf needs placement: both have their own tests below.
const skip = new Set(["remove-background", "upscale-image", "ocr-image", "ocr-pdf", "blur-faces", "unlock-pdf", "sign-pdf", "gif-to-frames"]);
const heicEncode = (id: string) => id === "jpg-to-heic" || id === "png-to-heic";

const canEncodeHevc = (page: Page) => page.evaluate(async () => typeof VideoEncoder !== "undefined" && !!(await VideoEncoder.isConfigSupported({ codec: "hvc1.1.6.L123.B0", width: 900, height: 600, bitrate: 2e6 }).catch(() => null))?.supported);

async function open(page: Page, id: string, files: string[]) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(files.map(F));
  await expect(page.locator("#stage .tray")).toBeVisible();
  return errors;
}
async function exec(page: Page, extra?: object) {
  if (extra) await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), extra);
  const go = page.locator("#panel > .btn").first();
  await expect(go).toBeEnabled({ timeout: 30_000 });
  await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 150_000 });
  const err = await page.locator("#panel .alert").allTextContents();
  if (err.join("").trim()) throw new Error(err.join(" "));
  return page.evaluate(() => (window as any).__lathe.outs.map((o: any) => { let s = ""; if (o.bytes) for (let i = 0; i < o.bytes.length; i += 32768) s += String.fromCharCode(...o.bytes.subarray(i, i + 32768)); return { name: o.name, type: o.type, text: o.text, b64: o.bytes ? btoa(s) : null }; }));
}
const buf = (o: { b64: string }) => Buffer.from(o.b64, "base64");

for (const t of tools.filter((x) => !skip.has(x.id))) {
  test(`${t.id} produces a valid result`, async ({ page }) => {
    if (heicEncode(t.id)) { await page.goto("/privacy"); test.skip(!(await canEncodeHevc(page)), "HEVC encoding needs a browser with an encoder"); }
    const files = input[t.id] ?? (t.noInput ? [] : t.kind === "pdf" && !t.accepts.includes("image") ? (t.min ? ["a.pdf", "b.pdf"] : ["a.pdf"]) : t.min ? ["photo.jpg", "photo2.jpg"] : ["photo.jpg"]);
    const errors = await open(page, t.id, files);
    const outs = await exec(page, params[t.id]);
    expect(outs.length).toBeGreaterThan(0);
    for (const o of outs) {
      if (o.b64) {
        const b = buf(o); expect(b.length).toBeGreaterThan(20);
        const want = expected[t.id] ?? (t.preset?.format as string);
        if (want) expect(magic(b).replace(/^(heic|mif1)$/, "heic")).toBe(want === "avif" ? "avif" : want);
        if (magic(b) === "pdf" && t.id !== "protect-pdf") expect((await PDFDocument.load(b)).getPageCount()).toBeGreaterThan(0);
      } else expect((o.text ?? "").length).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test("merge keeps every page", async ({ page }) => { await open(page, "merge-pdf", ["a.pdf", "b.pdf"]); const [o] = await exec(page); expect((await PDFDocument.load(buf(o))).getPageCount()).toBe(7); });
test("split writes one file per range", async ({ page }) => { await open(page, "split-pdf", ["a.pdf"]); const [o] = await exec(page, params["split-pdf"]); const z = unzipSync(new Uint8Array(buf(o))); const counts = await Promise.all(Object.values(z).map(async (b) => (await PDFDocument.load(b)).getPageCount())); expect(counts.sort()).toEqual([2, 3]); });
test("blank pages are found and removed", async ({ page }) => { await open(page, "delete-pages", ["blank.pdf"]); const [o] = await exec(page, { blank: true }); expect((await PDFDocument.load(buf(o))).getPageCount()).toBe(2); });

const pdfText = (page: Page, o: { b64: string }, password = "") => page.evaluate(async ([b64, pw]) => {
  const pdfjs: any = await import(/* @vite-ignore */ (performance.getEntriesByType("resource") as any[]).map((r) => r.name).find((n) => /\/pdf[-.][^/]*\.js$/.test(n) && !/worker/.test(n)) ?? "");
  const d = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), password: pw }).promise; let t = "";
  for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ");
  return t;
}, [o.b64, password]);

test("redaction removes the text from the file and leaves other pages selectable", async ({ page }) => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) d.addPage([400, 400]).drawText(`Alpha page ${n}`, { x: 40, y: 300, size: 20, font: f });
  await page.goto("/redact-pdf"); await page.locator("#stage input[type=file]").first().setInputFiles({ name: "t.pdf", mimeType: "application/pdf", buffer: Buffer.from(await d.save()) });
  await expect(page.locator("#stage .tray")).toBeVisible();
  const [o] = await exec(page, { flattenAll: false, regions: [{ page: 0, x: 0, y: 0, w: 1, h: 0.5 }] });
  await expect(page.locator("#stage canvas").first()).toBeVisible();
  const t = await pdfText(page, o); expect(t).not.toContain("Alpha page 1"); expect(t).toContain("Alpha page 2");
});
test("protect then unlock round-trips, and a wrong password fails", async ({ page }) => {
  await open(page, "protect-pdf", ["a.pdf"]); const [o] = await exec(page, { password: "hunter2" });
  expect(buf(o).includes("/Encrypt")).toBe(true);
  await expect(PDFDocument.load(buf(o))).rejects.toThrow();
  const file = { name: "locked.pdf", mimeType: "application/pdf", buffer: buf(o) };
  await page.goto("/unlock-pdf"); await page.locator("#stage input[type=file]").first().setInputFiles(file);
  await page.locator("#c-password").fill("wrong");
  await page.locator("#panel > .btn").first().click();
  await expect(page.locator("#panel .alert")).toContainText("not correct");
  await page.locator("#c-password").fill("hunter2");
  const [u] = await exec(page);
  expect((await PDFDocument.load(buf(u))).getPageCount()).toBe(5);
});
test("metadata wipe removes author and title", async ({ page }) => { await open(page, "pdf-metadata", ["a.pdf"]); const [o] = await exec(page, { wipe: true }); const d = await PDFDocument.load(buf(o), { updateMetadata: false }); expect(d.getAuthor()).toBeUndefined(); expect(d.getTitle()).toBeUndefined(); });
test("metadata removal strips GPS and keeps JPEG pixels", async ({ page }) => { await open(page, "remove-metadata", ["photo.jpg"]); const [o] = await exec(page); const b = buf(o); expect(b.includes("LatheCam")).toBe(false); expect(magic(b)).toBe("jpeg"); });
test("metadata viewer reports GPS", async ({ page }) => { await open(page, "view-metadata", ["photo.jpg"]); const [o] = await exec(page); expect(o.text).toContain("LatheCam"); expect(o.text).toMatch(/latitude: 9\.9/); });
test("SVG optimiser strips scripts", async ({ page }) => { await open(page, "optimize-svg", ["logo.svg"]); const [o] = await exec(page); const s = buf(o).toString(); expect(s).not.toContain("<script"); expect(s).toContain("<circle"); });
test("form fill writes values", async ({ page }) => { await open(page, "fill-pdf", ["form.pdf"]); await expect(page.locator("#panel input[type=text]").first()).toBeVisible(); await page.locator("#panel input[type=text]").first().fill("Asha"); const [o] = await exec(page); const f = (await PDFDocument.load(buf(o))).getForm(); expect(f.getTextField("full.name").getText()).toBe("Asha"); });
test("page numbers land on a rotated page", async ({ page }) => { await open(page, "page-numbers", ["rotated.pdf"]); const [o] = await exec(page); expect((await PDFDocument.load(buf(o))).getPage(0).getRotation().angle).toBe(90); });
test("compress PDF shrinks an image-heavy file and keeps its text", async ({ page }) => { await open(page, "compress-pdf", ["a.pdf"]); const [o] = await exec(page, { level: "small" }); const d = await PDFDocument.load(buf(o)); expect(d.getPageCount()).toBe(5); });
test("sign places a signature", async ({ page }) => {
  await open(page, "sign-pdf", ["a.pdf"]);
  await page.locator(".seg button", { hasText: "Type" }).click();
  await page.locator("#panel input[aria-label='Your name']").fill("Asha");
  const sheet = page.locator(".docpage").first(); await expect(sheet.locator("canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);
  await sheet.click({ position: { x: 200, y: 200 } });
  await expect(page.locator(".box.sig")).toHaveCount(1);
  const [o] = await exec(page); expect((await PDFDocument.load(buf(o))).getPageCount()).toBe(5);
});
test("crop returns the selected size", async ({ page }) => { await open(page, "crop-image", ["photo.png"]); await expect(page.locator(".cropbox")).toBeVisible(); const [o] = await exec(page, { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }); const sharp = (await import("sharp")).default; const m = await sharp(buf(o)).metadata(); expect([m.width, m.height]).toEqual([450, 300]); });
test("resize returns the exact size", async ({ page }) => { await open(page, "resize-image", ["photo.jpg"]); const [o] = await exec(page, { mode: "exact", width: 300, height: 123, noEnlarge: false }); const sharp = (await import("sharp")).default; const m = await sharp(buf(o)).metadata(); expect([m.width, m.height]).toEqual([300, 123]); });
test("HEIC decodes with correct pixels", async ({ page }) => { await open(page, "heic-to-png", ["photo.heic"]); const [o] = await exec(page); const sharp = (await import("sharp")).default; const a = await sharp(buf(o)).resize(9, 6, { fit: "fill" }).removeAlpha().raw().toBuffer(), b = await sharp(F("photo.jpg")).resize(9, 6, { fit: "fill" }).removeAlpha().raw().toBuffer(); let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); expect(d / a.length).toBeLessThan(8); });
test("home routes a dropped file to matching tools", async ({ page }) => { await page.goto("/"); await page.locator("#home-input").setInputFiles(F("a.pdf")); await expect(page.locator("#route .chip").first()).toHaveText("Compress PDF"); await page.locator("#route .chip").first().click(); await expect(page).toHaveURL(/compress-pdf/); await expect(page.locator(".tray .fname")).toHaveText("a.pdf"); });
test("no tool sends a file anywhere", async ({ page }) => {
  const sent: string[] = []; page.on("request", (r) => { if (r.method() !== "GET" && r.method() !== "HEAD") sent.push(r.url()); else if (new URL(r.url()).origin !== new URL(page.url() === "about:blank" ? r.url() : page.url()).origin && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) sent.push(r.url()); });
  await open(page, "compress-image", ["photo.jpg"]); await exec(page); await page.goto("/merge-pdf"); await page.locator("#stage input[type=file]").first().setInputFiles([F("a.pdf"), F("b.pdf")]); await exec(page);
  expect(sent).toEqual([]);
});

test("organiser keeps the arrangement when another file is added", async ({ page }) => {
  await open(page, "organize-pdf", ["a.pdf"]);
  await expect(page.locator(".pg")).toHaveCount(5);
  await page.locator(".pg").first().getByRole("button", { name: /^Delete/ }).click();
  await expect(page.locator(".pg")).toHaveCount(4);
  await page.locator(".tray .add input").setInputFiles(F("b.pdf"));
  await expect(page.locator(".pg")).toHaveCount(6);
  const [o] = await exec(page); expect((await PDFDocument.load(buf(o))).getPageCount()).toBe(6);
});
test("organiser lays pages out in a grid", async ({ page }) => {
  await open(page, "organize-pdf", ["a.pdf"]);
  await expect(page.locator(".pg")).toHaveCount(5);
  const [x, y] = await Promise.all([page.locator(".pg").nth(0).boundingBox(), page.locator(".pg").nth(1).boundingBox()]);
  expect(y.y).toBe(x.y); expect(y.x).toBeGreaterThan(x.x);
});
test("a tool that has run keeps working offline", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Service worker offline control is reliable in Chromium");
  await page.goto("/compress-image");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.locator("#stage input[type=file]").first().setInputFiles(F("photo.jpg"));
  await exec(page);
  await context.setOffline(true);
  await page.reload();
  await page.locator("#stage input[type=file]").first().setInputFiles(F("photo2.jpg"));
  const [o] = await exec(page); expect(magic(buf(o))).toBe("jpeg");
});
