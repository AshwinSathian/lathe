// Runs every tool under network capture. Files go nowhere, and third-party requests are limited to pinned model files.
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { test, expect, type Page } from "./fixture";
import { tools } from "../src/data/tools";
import { input, params } from "./tool-cases";

const pins = JSON.parse(readFileSync("src/engine/pins.json", "utf8"));
const F = (n: string) => `tests/fixtures/${n}`;
const MODELS = ["remove-background", "upscale-image", "ocr-image", "ocr-pdf", "blur-faces"];
const withModels = !process.env.CI || !!process.env.LATHE_MODELS;
const hevc = (page: Page) => page.evaluate(async () => typeof VideoEncoder !== "undefined" && !!(await VideoEncoder.isConfigSupported({ codec: "hvc1.1.6.L123.B0", width: 900, height: 600, bitrate: 2e6 }).catch(() => null))?.supported);

function allowed(url: string) {
  const u = new URL(url);
  if (u.hostname === "cdn.jsdelivr.net") return /^\/npm\/onnxruntime-web@[^/]+\/dist\/ort-wasm-simd-threaded\.asyncify\.wasm$/.test(u.pathname);
  // Small files redirect to Hugging Face's cache path, which still names the same model, commit and file.
  if (u.hostname === "huggingface.co") { const m = u.pathname.match(/^(?:\/api\/resolve-cache\/models)?\/([^/]+\/[^/]+)(?:\/resolve)?\/([0-9a-f]{40})\/(.+)$/); return !!m && pins.revisions[m[1]] === m[2] && !!pins.files[`${m[1]}/${m[3]}`]; }
  // Hugging Face redirects a pinned file to its own storage hosts.
  return u.hostname.endsWith(".hf.co") || u.hostname.endsWith(".huggingface.co");
}
test.describe.configure({ timeout: 1_500_000 });
test("no tool sends file data, and third parties see only pinned downloads", async ({ page, browserName, baseURL }) => {
  test.skip(browserName !== "chromium", "One engine is enough for a run of every tool");
  test.setTimeout(1_500_000);
  const origin = new URL(baseURL).origin, bad: string[] = [], third: string[] = [], done: string[] = [], skipped: string[] = [];
  page.on("request", (r) => {
    const url = r.url(); if (url.startsWith("blob:") || url.startsWith("data:")) return;
    if (!["GET", "HEAD"].includes(r.method()) || r.postDataBuffer()) bad.push(`${r.method()} ${url}`);
    if (new URL(url).origin !== origin) { third.push(url); if (!allowed(url)) bad.push(`unexpected ${url}`); }
  });
  const locked = await (async () => {
    await page.goto("/protect-pdf"); await page.locator("#stage input[type=file]").first().setInputFiles(F("b.pdf")); await page.evaluate(() => { (window as any).__lathe.params.password = "pw"; });
    await page.locator("#panel > .btn").first().click(); await page.locator("#panel .results a[download]").first().waitFor({ timeout: 60_000 });
    return page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); });
  })();
  const gif = await sharp(await Promise.all(["#f00", "#0f0"].map((background) => sharp({ create: { width: 40, height: 40, channels: 3, background } }).png().toBuffer())), { join: { animated: true } }).gif().toBuffer();
  const scan = await (async () => { const d = await PDFDocument.create(), im = await d.embedPng(await sharp({ create: { width: 500, height: 120, channels: 3, background: "#fff" } }).composite([{ input: Buffer.from(`<svg width="500" height="120"><text x="10" y="80" font-size="60" font-family="Arial">Lathe</text></svg>`) }]).png().toBuffer()); d.addPage([250, 60]).drawImage(im, { x: 0, y: 0, width: 250, height: 60 }); return Buffer.from(await d.save()); })();
  for (const t of tools) {
    if (MODELS.includes(t.id) && !withModels) { skipped.push(t.id); continue; }
    await page.goto(`/${t.id}`);
    if (["jpg-to-heic", "png-to-heic"].includes(t.id) && !(await hevc(page))) { skipped.push(t.id); continue; }
    const fallback = t.noInput ? [] : t.kind === "pdf" && !t.accepts.includes("image") ? (t.min ? ["a.pdf", "b.pdf"] : ["a.pdf"]) : t.min ? ["photo.jpg", "photo2.jpg"] : ["photo.jpg"];
    const files: any = t.id === "unlock-pdf" ? { name: "l.pdf", mimeType: "application/pdf", buffer: Buffer.from(locked, "base64") } : t.id === "gif-to-frames" ? { name: "a.gif", mimeType: "image/gif", buffer: gif } : t.id === "ocr-pdf" ? { name: "s.pdf", mimeType: "application/pdf", buffer: scan } : (input[t.id] ?? fallback).map(F);
    if (!t.noInput) { await page.locator("#stage input[type=file]").first().setInputFiles(files); await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible({ timeout: 30_000 }); }
    const extra: object = { ...(params[t.id] ?? {}), ...(t.id === "unlock-pdf" ? { password: "pw" } : {}), ...(t.id === "markdown-to-pdf" ? { text: "# Hello" } : {}) };
    if (t.id === "fill-pdf") await page.waitForFunction(() => !!(window as any).__lathe.params.values);
    if (t.id === "organize-pdf") await page.waitForFunction(() => (window as any).__lathe.params.order?.length > 0);
    await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), extra);
    if (t.id === "sign-pdf") { await page.locator("#panel .seg button", { hasText: "Type" }).click(); await page.getByLabel("Your name").fill("A. Rao"); await page.getByRole("button", { name: "Place signature on page 1" }).click(); await expect(page.locator(".box.sig")).toHaveCount(1); }
    const go = page.locator("#panel > .btn").first(); await expect(go, t.id).toBeEnabled({ timeout: 30_000 }); await go.click();
    await expect(page.locator("#panel .results h2, #panel .alert").first(), t.id).toBeVisible({ timeout: 300_000 });
    expect((await page.locator("#panel .alert").allTextContents()).join(""), t.id).toBe("");
    done.push(t.id);
  }
  expect(bad).toEqual([]);
  expect(done.length + skipped.length).toBe(tools.length);
  if (withModels) expect(third.some((u) => u.includes("huggingface.co"))).toBe(true);
  console.log(`network: ${done.length} tools ran, skipped: ${skipped.join(", ") || "none"}, third-party requests: ${third.length}`);
});
