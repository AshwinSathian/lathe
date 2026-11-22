// Every core flow must work by keyboard and touch, and stay readable in forced colours.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "./fixture";

const F = (n: string) => `tests/fixtures/${n}`;
const go = (page: Page) => page.locator("#panel > .btn").first();
const open = async (page: Page, id: string, file = "a.pdf") => { await page.goto(`/${id}`); await page.locator("#stage input[type=file]").first().setInputFiles(F(file)); await expect(page.locator("#stage .tray:not(.intake)")).toBeVisible(); };
const finished = (page: Page) => expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
const regions = (page: Page) => page.evaluate(() => (window as any).__lathe.params.regions as { x: number; y: number; w: number; h: number }[]);

test("redaction works from the keyboard alone", async ({ page }) => {
  await open(page, "redact-pdf");
  const add = page.getByRole("button", { name: "Add box on page 1" }); await add.focus(); await page.keyboard.press("Enter");
  const box = page.locator(".docpage .box").first(); await expect(box).toBeFocused();
  const a = (await regions(page))[0];
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
  const b = (await regions(page))[0];
  expect(b.x).toBeGreaterThan(a.x); expect(b.h).toBeGreaterThan(a.h);
  await page.keyboard.press("Delete");
  await expect(page.locator(".docpage .box")).toHaveCount(0);
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter"); await expect(box).toBeFocused();
  await go(page).focus(); await page.keyboard.press("Enter"); await finished(page);
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
});
test("a signature can be placed from the keyboard alone", async ({ page }) => {
  await open(page, "sign-pdf");
  await page.locator("#panel .seg button", { hasText: "Type" }).click();
  await page.getByLabel("Your name").fill("A. Rao");
  const place = page.getByRole("button", { name: "Place signature on page 1" }); await expect(place).toBeEnabled(); await place.focus(); await page.keyboard.press("Enter");
  const box = page.locator(".docpage .box.sig").first(); await expect(box).toBeFocused();
  const x = await box.evaluate((n: HTMLElement) => parseFloat(n.style.left));
  await page.keyboard.press("ArrowRight");
  expect(await box.evaluate((n: HTMLElement) => parseFloat(n.style.left))).toBeGreaterThan(x);
  await expect(go(page)).toBeEnabled(); await go(page).focus(); await page.keyboard.press("Enter"); await finished(page);
  expect((await page.locator("#panel .alert").allTextContents()).join("")).toBe("");
});
test("placing a signature before making one explains what to do", async ({ page }) => {
  await open(page, "sign-pdf");
  await page.getByRole("button", { name: "Place signature on page 1" }).click();
  await expect(page.locator("#panel [aria-live]").filter({ hasText: /signature first/i }).first()).toBeVisible();
});
test("signing says it is a visual signature, beside the control", async ({ page }) => {
  await open(page, "sign-pdf");
  await expect(page.locator("#panel")).toContainText("not a certified digital signature");
});
test("a file can be removed by keyboard, and the tray has no nested buttons", async ({ page }) => {
  await page.goto("/compress-image");
  await page.locator("#stage input[type=file]").first().setInputFiles([F("photo.jpg"), F("photo2.jpg")]);
  await expect(page.locator(".tray .fname")).toHaveCount(2);
  expect(await page.locator("button button, button [role=button]").count()).toBe(0);
  const x = page.getByRole("button", { name: "Remove photo.jpg" }); await x.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".tray .fname")).toHaveText(["photo2.jpg"]);
  await expect(page.getByRole("button", { name: "Remove photo2.jpg" })).toBeFocused();
});
test("focus moves to the download when a run finishes", async ({ page }) => {
  await open(page, "compress-image", "photo.jpg");
  await go(page).focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#panel .results a[download]").first()).toBeFocused({ timeout: 30_000 });
});
test("reordering keeps focus, announces the move and can undo a delete", async ({ page }) => {
  await open(page, "organize-pdf");
  await expect(page.locator(".pg")).toHaveCount(5);
  const later = page.locator(".pg").first().locator("button[title='Move later']"); await later.focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".pg").nth(1).locator("button[title='Move later']")).toBeFocused();
  await expect(page.locator("#panel [role=status]").first()).toContainText("moved to position 2");
  await page.locator(".pg").first().locator("button[title=Delete]").click();
  await expect(page.locator(".pg")).toHaveCount(4);
  await page.getByRole("button", { name: "Undo delete" }).click();
  await expect(page.locator(".pg")).toHaveCount(5);
  expect(await page.evaluate(() => (window as any).__lathe.params.order.length)).toBe(5);
});
test("a touch swipe scrolls the document and draws nothing", async ({ page }) => {
  await open(page, "redact-pdf");
  const sheet = page.locator(".docpage").first(); await expect(sheet.locator("canvas")).toBeVisible({ timeout: 20_000 });
  expect(await sheet.evaluate((n) => getComputedStyle(n).touchAction)).not.toBe("none");
  await sheet.evaluate((n) => { const o = { bubbles: true, pointerId: 7, pointerType: "touch", clientX: n.getBoundingClientRect().x + 40, clientY: n.getBoundingClientRect().y + 40 }; n.dispatchEvent(new PointerEvent("pointerdown", o)); n.dispatchEvent(new PointerEvent("pointermove", { ...o, clientX: o.clientX + 90, clientY: o.clientY + 90 })); n.dispatchEvent(new PointerEvent("pointerup", o)); });
  await expect(page.locator(".docpage .box")).toHaveCount(0);
});
test("mark handles are large enough and apart", async ({ page }) => {
  await open(page, "redact-pdf");
  await page.getByRole("button", { name: "Add box on page 1" }).click();
  const g = await page.locator(".box .grip").boundingBox(), d = await page.locator(".box .del").boundingBox();
  for (const b of [g, d]) { expect(b.width).toBeGreaterThanOrEqual(24); expect(b.height).toBeGreaterThanOrEqual(24); }
  expect(Math.hypot(g.x - d.x, g.y - d.y)).toBeGreaterThan(40);
});
test("the redaction safety switch differs on and off in forced colours", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Forced colours emulation is Chromium only");
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/redact-pdf");
  const t = page.locator("#panel .check input").first(), on = await t.screenshot(); await t.click({ force: true }); await page.waitForTimeout(300);
  expect(Buffer.compare(on, await t.screenshot())).not.toBe(0);
});
test("the command palette has valid list markup", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One engine is enough");
  await page.goto("/"); await page.locator("[data-palette]").click(); await page.locator("dialog input").fill("pdf");
  await expect(page.locator("dialog [role=option]").first()).toBeVisible();
  const r = await new AxeBuilder({ page }).include("dialog").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("ArrowDown");
  const active = await page.locator("dialog input").getAttribute("aria-activedescendant");
  expect(await page.locator(`[id="${active}"]`).getAttribute("aria-selected")).toBe("true");
});
test("the before and after divider is a real slider", async ({ page }) => {
  await open(page, "adjust-image", "photo.jpg");
  await page.evaluate(() => { const l = (window as any).__lathe; l.params.exposure = 0.4; });
  await page.locator("#panel input[type=range]").first().fill("0.4");
  const s = page.getByRole("slider", { name: /Compare before and after/ }); await expect(s).toBeVisible({ timeout: 15_000 });
  await s.focus(); const v = +(await s.getAttribute("aria-valuenow")); await page.keyboard.press("ArrowRight");
  expect(+(await s.getAttribute("aria-valuenow"))).toBe(v + 2);
});
test("Shift and arrow resizes a fixed-ratio crop", async ({ page }) => {
  await open(page, "crop-image", "photo.jpg");
  await page.locator("#c-aspect").selectOption({ index: 2 });
  const box = page.locator(".cropbox"); await box.focus();
  const w = await box.evaluate((n: HTMLElement) => parseFloat(n.style.width));
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await box.evaluate((n: HTMLElement) => parseFloat(n.style.width))).toBeLessThan(w);
});
test("a file that cannot be read is announced", async ({ page }) => {
  await page.goto("/compress-image");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "bad.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") });
  await expect(page.locator("#panel [role=status]").first()).toContainText(/could not be read/i);
});
test("typing a signature does not pile up object URLs", async ({ page }) => {
  await page.addInitScript(() => { const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL); (window as any).__urls = new Set(); URL.createObjectURL = (b: any) => { const u = c(b); (window as any).__urls.add(u); return u; }; URL.revokeObjectURL = (u: string) => { (window as any).__urls.delete(u); r(u); }; });
  await open(page, "sign-pdf");
  await page.locator("#panel .seg button", { hasText: "Type" }).click();
  await page.getByLabel("Your name").pressSequentially("Ashok Rao", { delay: 30 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__urls.size)).toBeLessThanOrEqual(2);
});
test("the photo editor names its action and can reset every slider", async ({ page }) => {
  await open(page, "adjust-image", "photo.jpg");
  await expect(go(page)).toHaveText("Save photo");
  const r = page.locator("#panel input[type=range]").first(), start = await r.inputValue(); await r.fill("0.8");
  await page.getByRole("button", { name: "Reset all" }).click();
  expect(await r.inputValue()).toBe(start);
});
test("on a phone the photo stays in view while adjusting sliders", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "adjust-image", "photo.jpg");
  const last = page.locator("#panel input[type=range]").nth(8); await last.scrollIntoViewIfNeeded();
  await expect(page.locator(".frame")).toBeInViewport();
  await expect(last).toBeInViewport();
});
