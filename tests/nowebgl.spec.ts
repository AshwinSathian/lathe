// With WebGL2 turned off, photo tools must still work and match the GPU result.
import { test, expect, firefox, type Browser } from "@playwright/test";
import sharp from "sharp";

async function edit(browser: Browser, baseURL: string) {
  const page = await browser.newPage({ baseURL });
  await page.addInitScript(() => { (window as any).__latheTest = true; });
  await page.goto("/adjust-image");
  const gl = await page.evaluate(() => !!new OffscreenCanvas(1, 1).getContext("webgl2"));
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/photo.png");
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible();
  await page.evaluate(() => Object.assign((window as any).__lathe.params, { exposure: 0.4, contrast: 25, shadows: 20, highlights: -15, temperature: 18, tint: -6, saturation: 22, vibrance: 15, vignette: 30, format: "png" }));
  const go = page.locator("#panel > .btn").first(); await expect(go).toBeEnabled(); await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
  const b64 = await page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); });
  await page.close();
  return { gl, png: Buffer.from(b64, "base64") };
}
test("the CPU path matches the GPU path", async ({ browserName, baseURL }) => {
  test.skip(browserName !== "firefox", "Firefox has a preference that turns WebGL off");
  const off = await firefox.launch({ firefoxUserPrefs: { "webgl.disabled": true } }), on = await firefox.launch();
  try {
    const cpu = await edit(off, baseURL); expect(cpu.gl).toBe(false);
    const raw = (b: Buffer) => sharp(b).removeAlpha().raw().toBuffer(), a = await raw(cpu.png), src = await raw(await sharp("tests/fixtures/photo.png").toBuffer());
    let moved = 0; for (let i = 0; i < a.length; i++) moved += Math.abs(a[i] - src[i]); expect(moved / a.length).toBeGreaterThan(5);
    const gpu = await edit(on, baseURL);
    test.skip(!gpu.gl, "This machine has no WebGL2 to compare with");
    const z = await raw(gpu.png); let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - z[i]);
    expect(d / a.length).toBeLessThan(2);
  } finally { await off.close(); await on.close(); }
});
