// Real pointer input and accessibility, the parts the tool tests set directly.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

const F = (n: string) => `tests/fixtures/${n}`;
const open = async (page: Page, id: string, files: string[]) => { await page.goto(`/${id}`); await page.locator("#stage input[type=file]").first().setInputFiles(files.map(F)); await expect(page.locator("#stage .tray")).toBeVisible(); };
const run = async (page: Page) => {
  await page.locator("#panel > .btn").first().click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
  return Buffer.from(await page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); }), "base64");
};
const drag = async (page: Page, x0: number, y0: number, x1: number, y1: number) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up(); };

test("dragging a crop corner changes the output", async ({ page }) => {
  await open(page, "crop-image", ["photo.png"]);
  const b = await page.locator(".cropbox").boundingBox();
  await drag(page, b.x + b.width - 4, b.y + b.height - 4, b.x + b.width / 2, b.y + b.height / 2);
  const m = await sharp(await run(page)).metadata();
  expect(m.width).toBeGreaterThan(330); expect(m.width).toBeLessThan(420); expect(m.height).toBeGreaterThan(220); expect(m.height).toBeLessThan(280);
});
test("drawing a redaction box removes what is under it", async ({ page }) => {
  await open(page, "redact-pdf", ["a.pdf"]);
  const sheet = page.locator(".docpage").first(); await expect(sheet.locator("canvas")).toBeVisible({ timeout: 20_000 });
  const b = await sheet.boundingBox();
  await drag(page, b.x + 2, b.y + 2, b.x + b.width - 2, b.y + b.height * 0.15);
  await expect(page.locator(".box")).toHaveCount(1);
  const out = await run(page), d = await PDFDocument.load(out); expect(d.getPageCount()).toBe(5);
  expect(out.toString("latin1")).not.toContain("Alpha page 1");
});
test("dragging a page thumbnail reorders the document", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright cannot synthesise HTML drag and drop in WebKit; the move buttons cover it");
  await open(page, "organize-pdf", ["a.pdf"]);
  await expect(page.locator(".pg")).toHaveCount(5); await expect(page.locator(".pg canvas").nth(2)).toBeVisible({ timeout: 20_000 });
  await page.locator(".pg .sheet").nth(0).dragTo(page.locator(".pg .sheet").nth(2));
  const order = await page.evaluate(() => (window as any).__lathe.params.order.map((o: any) => o.page));
  expect(order[0]).toBe(1); expect(order.indexOf(0)).toBe(2);
});
test("the before and after wipe follows the pointer and the keyboard", async ({ page }) => {
  await open(page, "adjust-image", ["photo.jpg"]);
  const h = page.locator(".wipe"); await expect(h).toBeVisible({ timeout: 20_000 });
  const f = await page.locator(".frame").boundingBox(), b = await h.boundingBox();
  await drag(page, b.x + b.width / 2, b.y + b.height / 2, f.x + f.width * 0.25, b.y + b.height / 2);
  const cut = () => page.locator(".frame").evaluate((n: HTMLElement) => parseFloat(n.style.getPropertyValue("--cut")));
  expect(Math.abs((await cut()) - 25)).toBeLessThan(3);
  await h.focus(); const before = await cut(); await page.keyboard.press("ArrowRight"); expect(await cut()).toBeCloseTo(before + 2, 0);
});
for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 640 }]) test(`the action button is reachable with many controls at ${viewport.height}px`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await open(page, "adjust-image", ["photo.jpg"]);
  await page.evaluate(() => scrollTo({ top: document.querySelector("#panel").getBoundingClientRect().top + scrollY - 10, behavior: "instant" }));
  const b = await page.locator("#panel > .btn").first().boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
  const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement)?.closest("#panel > .btn") !== null, [b.x + b.width / 2, b.y + b.height / 2]);
  expect(hit).toBe(true);
  const last = page.locator("#c-format"); await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
});
test("the command palette finds and opens a tool by keyboard", async ({ page }) => {
  await page.goto("/"); await page.locator("[data-palette]").click();
  await page.locator("dialog input").fill("heic jpg");
  await expect(page.locator("dialog a").first()).toContainText("HEIC to JPG");
  await page.keyboard.press("Enter"); await expect(page).toHaveURL(/heic-to-jpg/);
});
for (const [name, path, file] of [["home", "/", null], ["tool, empty", "/compress-pdf", null], ["image tool, loaded", "/adjust-image", "photo.jpg"], ["PDF tool, loaded", "/organize-pdf", "a.pdf"], ["privacy", "/privacy", null]] as const) {
  for (const colorScheme of ["light", "dark"] as const) test(`no serious accessibility issues: ${name}, ${colorScheme}`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "One engine is enough");
    await page.emulateMedia({ colorScheme }); await page.goto(path);
    if (file) { await page.locator("#stage input[type=file]").first().setInputFiles(F(file)); await expect(page.locator("#stage .tray")).toBeVisible(); await page.waitForTimeout(800); }
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}
