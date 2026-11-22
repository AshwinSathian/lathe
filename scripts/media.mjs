// Captures the screenshots and demo in docs/images from a local build. Needs `npx wrangler dev --port 8797` running.
import { chromium } from "playwright";
import sharp from "sharp";
const base = "http://localhost:8797", out = "docs/images";
const scene = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#27406f"/><stop offset=".55" stop-color="#d98a6a"/><stop offset=".8" stop-color="#f5cf94"/></linearGradient><radialGradient id="u"><stop stop-color="#fff3d0"/><stop offset=".22" stop-color="#ffd98f" stop-opacity=".8"/><stop offset="1" stop-color="#ffd98f" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="1067" fill="url(#s)"/><circle cx="1090" cy="560" r="330" fill="url(#u)"/><path d="M0 660 220 500 410 610 660 430 900 620 1130 500 1600 690V1067H0z" fill="#59608a"/><path d="M0 760 300 610 520 730 820 570 1110 750 1370 640 1600 760V1067H0z" fill="#39446f"/><path d="M0 880 260 760 610 880 930 730 1250 880 1600 800V1067H0z" fill="#212c50"/><path d="M0 980 420 880 800 980 1200 900 1600 990V1067H0z" fill="#121a35"/></svg>`)).jpeg({ quality: 92 }).toBuffer();
const browser = await chromium.launch({ args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const shot = async (page, name) => writeJpeg(await page.screenshot(), name);
const writeJpeg = (png, name) => sharp(png).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 84 }).toFile(`${out}/${name}.webp`);
for (const colorScheme of ["dark", "light"]) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme }), p = await c.newPage();
  await p.goto(`${base}/`); await p.waitForTimeout(900); await shot(p, `home-${colorScheme}`);
  await p.goto(`${base}/adjust-image`); await p.locator("#stage input[type=file]").first().setInputFiles({ name: "dusk.jpg", mimeType: "image/jpeg", buffer: scene });
  await p.waitForSelector(".wipe"); for (const [k, v] of [["exposure", ".25"], ["contrast", "24"], ["saturation", "38"], ["temperature", "-22"], ["vignette", "30"]]) await p.locator(`#c-${k}`).fill(v);
  await p.waitForTimeout(900); await shot(p, `editor-${colorScheme}`);
  await c.close();
}
const c = await browser.newContext({ viewport: { width: 1200, height: 750 }, colorScheme: "dark" }), p = await c.newPage();
await p.goto(`${base}/organize-pdf`); await p.locator("#stage input[type=file]").first().setInputFiles(["tests/fixtures/a.pdf", "tests/fixtures/b.pdf"]); await p.waitForTimeout(1400); await shot(p, "organiser");
await p.goto(`${base}/adjust-image`); await p.locator("#stage input[type=file]").first().setInputFiles({ name: "dusk.jpg", mimeType: "image/jpeg", buffer: scene });
await p.waitForSelector(".wipe"); for (const [k, v] of [["contrast", "24"], ["saturation", "42"], ["temperature", "-22"], ["vignette", "32"]]) await p.locator(`#c-${k}`).fill(v); await p.waitForTimeout(500);
const frames = [], box = await p.locator("#stage").boundingBox();
for (let i = 0; i < 36; i++) { await p.locator(".frame").evaluate((n, v) => n.style.setProperty("--cut", `${v}%`), 50 + 34 * Math.sin((i / 36) * Math.PI * 2)); frames.push(await sharp(await p.screenshot({ clip: box })).resize({ width: 760 }).png().toBuffer()); }
await sharp(frames, { join: { animated: true } }).webp({ quality: 62, delay: 70, loop: 0, effort: 6 }).toFile(`${out}/demo.webp`);
await browser.close();
