// Runs as a visitor would: no test hook, a real file picker, a real click and a real download.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

test("the test hook is absent for a normal visitor", async ({ page }) => {
  await page.goto("/compress-image");
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/photo.jpg");
  await page.locator("#stage .tray").waitFor();
  expect(await page.evaluate(() => "__lathe" in window)).toBe(false);
});

const finish = async (page: import("@playwright/test").Page) => {
  const go = page.locator("#panel > .btn").first();
  await expect(go).toBeEnabled();
  await go.click();
  const link = page.locator("#panel .results a[download]").first();
  await link.waitFor({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  return readFileSync(await download.path());
};

test("an image tool works from upload to download", async ({ page }) => {
  await page.goto("/resize-image");
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/photo.jpg");
  const meta = await sharp(await finish(page)).metadata();
  expect(meta.width).toBeGreaterThan(0);
});

test("a PDF tool works from upload to download", async ({ page }) => {
  await page.goto("/rotate-pdf");
  await page.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/a.pdf");
  const doc = await PDFDocument.load(await finish(page));
  expect(doc.getPageCount()).toBe(5);
});
