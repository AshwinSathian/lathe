// These run the real models, so they need the network and take minutes on first run.
import { test, expect, type Page } from "./fixture";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { unzipSync } from "fflate";

test.describe.configure({ timeout: 560_000 });
test.skip(({ browserName }) => browserName !== "chromium", "One engine is enough for model runs");

const run = async (page: Page, id: string, file: any, extra: object = {}) => {
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(file);
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible();
  await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), extra);
  const go = page.locator("#panel > .btn").first();
  await expect(go).toBeEnabled({ timeout: 30_000 });
  await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 540_000 });
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
  return page.evaluate(() => (window as any).__lathe.outs.map((o: any) => { let s = ""; if (o.bytes) for (let i = 0; i < o.bytes.length; i += 32768) s += String.fromCharCode(...o.bytes.subarray(i, i + 32768)); return { text: o.text, note: o.note, b64: o.bytes ? btoa(s) : null }; }));
};
const textPng = () => sharp({ create: { width: 900, height: 260, channels: 3, background: "#fff" } }).composite([{ input: Buffer.from(`<svg width="900" height="260"><text x="40" y="150" font-family="Arial" font-size="72" fill="#000">Hello Lathe 2026</text></svg>`) }]).png().toBuffer();

test("OCR reads text from an image", async ({ page }) => {
  const [o] = await run(page, "ocr-image", { name: "t.png", mimeType: "image/png", buffer: await textPng() });
  expect(o.text).toMatch(/Hello\s+Lathe\s+2026/);
});
test("OCR PDF adds a searchable layer", async ({ page }) => {
  const d = await PDFDocument.create(), im = await d.embedPng(await textPng()), p = d.addPage([612, 200]); p.drawImage(im, { x: 0, y: 0, width: 612, height: 177 });
  const [o] = await run(page, "ocr-pdf", { name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await d.save()) }, { dpi: 200 });
  expect(o.note).toMatch(/Added [1-9]/);
  await page.goto("/pdf-to-text");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "o.pdf", mimeType: "application/pdf", buffer: Buffer.from(o.b64, "base64") });
  await page.locator("#panel > .btn").first().click();
  await expect(page.locator(".textout")).toHaveValue(/Lathe/, { timeout: 30_000 });
});
// Headless Chromium has no GPU here, so this exercises the CPU model, which is built for people: it gets a portrait.
test("background removal produces a real matte", async ({ page }) => {
  const r = await fetch("https://storage.googleapis.com/mediapipe-assets/portrait.jpg"); expect(r.ok).toBe(true);
  const [o] = await run(page, "remove-background", { name: "portrait.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await r.arrayBuffer()) });
  const { data, info } = await sharp(Buffer.from(o.b64, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0, solid = 0; for (let i = 3; i < data.length; i += 4) { if (data[i] < 16) clear++; if (data[i] > 240) solid++; }
  const n = info.width * info.height; expect(clear / n).toBeGreaterThan(0.05); expect(solid / n).toBeGreaterThan(0.05);
});
test("upscaler doubles the resolution", async ({ page }) => {
  const [o] = await run(page, "upscale-image", "tests/fixtures/small.png");
  const m = await sharp(Buffer.from(o.b64, "base64")).metadata(), s = await sharp("tests/fixtures/small.png").metadata();
  expect([m.width, m.height]).toEqual([s.width * 2, s.height * 2]);
});
test("face blur finds a face", async ({ page }) => {
  const r = await fetch("https://storage.googleapis.com/mediapipe-assets/portrait.jpg"); expect(r.ok).toBe(true);
  const [o] = await run(page, "blur-faces", { name: "portrait.jpg", mimeType: "image/jpeg", buffer: Buffer.from(await r.arrayBuffer()) });
  expect(o.note).toMatch(/Hid [1-9]/);
});
test("GIF to frames splits an animation", async ({ page }) => {
  const frames = await Promise.all(["#f00", "#0f0", "#00f"].map((background) => sharp({ create: { width: 40, height: 40, channels: 3, background } }).png().toBuffer()));
  const gif = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
  const [o] = await run(page, "gif-to-frames", { name: "a.gif", mimeType: "image/gif", buffer: gif });
  expect(Object.keys(unzipSync(new Uint8Array(Buffer.from(o.b64, "base64")))).length).toBe(3);
});
