// HEIC export is checked by an independent decoder (macOS ImageIO through sips), not by Lathe's own reader.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

for (const [w, h] of [[900, 600], [901, 601], [64, 64], [3000, 2000]]) {
  test(`HEIC export at ${w}x${h} opens in macOS with matching pixels`, async ({ page }) => {
    test.skip(process.platform !== "darwin", "sips is the independent decoder");
    await page.goto("/privacy");
    test.skip(!(await page.evaluate(async () => typeof VideoEncoder !== "undefined" && !!(await VideoEncoder.isConfigSupported({ codec: "hvc1.1.6.L123.B0", width: 900, height: 600, bitrate: 2e6 }).catch(() => null))?.supported)), "needs an HEVC encoder");
    const src = await sharp("tests/fixtures/photo.png").resize(w, h, { fit: "fill" }).png().toBuffer();
    await page.goto("/png-to-heic");
    await page.locator("#stage input[type=file]").first().setInputFiles({ name: "t.png", mimeType: "image/png", buffer: src });
    await page.locator("#panel > .btn").first().click();
    await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
    expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
    const b64 = await page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); });
    const dir = mkdtempSync(join(tmpdir(), "lathe-")), heic = join(dir, "o.heic"), png = join(dir, "o.png");
    writeFileSync(heic, Buffer.from(b64, "base64"));
    execFileSync("sips", ["-s", "format", "png", heic, "--out", png], { stdio: "ignore" });
    const m = await sharp(png).metadata();
    expect([m.width, m.height]).toEqual([w, h]);
    const size = { width: 32, height: 32, fit: "fill" as const };
    const a = await sharp(png).resize(size).removeAlpha().raw().toBuffer(), z = await sharp(src).resize(size).removeAlpha().raw().toBuffer();
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - z[i]);
    expect(d / a.length).toBeLessThan(10);
  });
}
