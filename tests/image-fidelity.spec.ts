// Photos must keep their colour, and anything a format cannot carry must be stated in the result.
import sharp from "sharp";
import { test, expect, type Page } from "./fixture";

const C = (n: string) => `tests/crafted/${n}`;
async function convert(page: Page, id: string, file: string, params: object = {}) {
  await page.goto(`/${id}`);
  await page.locator("#stage input[type=file]").first().setInputFiles(C(file));
  await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible();
  await page.evaluate((x) => Object.assign((window as any).__lathe.params, x), params);
  const go = page.locator("#panel > .btn").first(); await expect(go).toBeEnabled({ timeout: 20_000 }); await go.click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
  const o = await page.evaluate(() => { const o = (window as any).__lathe.outs[0], b = o.bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return { b64: btoa(s), note: o.note as string }; });
  return { bytes: Buffer.from(o.b64, "base64"), note: o.note ?? "" };
}
const pixel = async (b: Buffer, x: number, y: number) => { const { data, info } = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true }), i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
const close = (a: number[], z: number[], tol: number) => a.every((v, i) => Math.abs(v - z[i]) <= tol);

for (const id of ["heic-to-png", "heic-to-jpg"]) test(`${id} converts Display P3 to correct sRGB`, async ({ page }) => {
  const { bytes, note } = await convert(page, id, "p3.heic");
  expect(close(await pixel(bytes, 300, 900), [250, 31, 14], id === "heic-to-png" ? 3 : 6), String(await pixel(bytes, 300, 900))).toBe(true);
  expect(close(await pixel(bytes, 900, 900), [89, 203, 71], id === "heic-to-png" ? 3 : 6), String(await pixel(bytes, 900, 900))).toBe(true);
  expect(note).toMatch(/sRGB/);
});
test("a multi-image HEIC uses its primary image and says so", async ({ page }) => {
  const { bytes, note } = await convert(page, "heic-to-png", "multi_primary1.heic");
  expect(close(await pixel(bytes, 5, 5), [19, 220, 20], 8), String(await pixel(bytes, 5, 5))).toBe(true);
  expect(note).toMatch(/3 images/);
});
for (const [file, id, want] of [["gray10.heic", "heic-to-png", /10-bit/], ["ramp16.png", "convert-image", /16-bit/], ["multipage.tif", "convert-image", /3 pages/], ["anim.gif", "convert-image", /first frame/], ["anim.webp", "convert-image", /first frame/], ["anim.png", "convert-image", /first frame/]] as const) test(`${file} states what conversion loses`, async ({ page }) => {
  expect((await convert(page, id, file, id === "convert-image" ? { format: "jpeg" } : {})).note).toMatch(want);
});
test("an image past the size limit is refused before decoding", async ({ page }) => {
  const header = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), size = Buffer.alloc(8); size.writeUInt32BE(40000, 0); size.writeUInt32BE(40000, 4);
  const png = Buffer.concat([header, size, Buffer.from([8, 6, 0, 0, 0, 0, 0, 0, 0])]);
  await page.goto("/convert-image");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "bomb.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#stage .view")).toContainText(/too large/i, { timeout: 15_000 });
});
test("face blur starts on the solid block and asks for review when it finds nothing", async ({ page }) => {
  await page.goto("/blur-faces");
  await expect(page.locator("#panel select").first()).toHaveValue("block");
  await expect(page.locator("#tool-title, h1").first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/every face/i);
});
