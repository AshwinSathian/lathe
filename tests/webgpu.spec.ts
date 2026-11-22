// Runs background removal on a real GPU when the machine has one. Enable with LATHE_GPU=1.
import { test, expect } from "./fixture";
import sharp from "sharp";
test.use({ launchOptions: { args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"] } });
test("background removal on WebGPU", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium" || !process.env.LATHE_GPU, "Opt-in");
  test.setTimeout(400_000);
  const logs: string[] = []; page.on("console", (m) => logs.push(m.text()));
  await page.goto("/remove-background");
  console.log("adapter", await page.evaluate(async () => { const a = await (navigator as any).gpu?.requestAdapter(); return a ? a.info?.vendor + " " + a.info?.architecture : "none"; }));
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/photo.jpg");
  const go = page.locator("#panel > .btn").first(); await expect(go).toBeEnabled({ timeout: 30_000 });
  const t = Date.now(); await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 380_000 });
  console.log("ms", Date.now() - t, "fellback", logs.filter((l) => /WebGPU.*failed/.test(l)).map((l) => l.slice(0, 200)));
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
  const b64 = await page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); });
  const { data } = await sharp(Buffer.from(b64, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0; for (let i = 3; i < data.length; i += 4) if (data[i] < 16) clear++;
  expect(clear).toBeGreaterThan(1000);
});
