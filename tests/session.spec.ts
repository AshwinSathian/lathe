// A mark, a result and a file must always belong together. These run through real pointer input.
import { test, expect, type Page } from "./fixture";
import { PDFDocument } from "pdf-lib";

const F = (n: string) => `tests/fixtures/${n}`;
const go = (page: Page) => page.locator("#panel > .btn").first();
const open = async (page: Page, id: string, file: string) => { await page.goto(`/${id}`); await page.locator("#stage input[type=file]").first().setInputFiles(F(file)); await expect(page.locator("#stage .tray")).toBeVisible(); };
const firstSheet = async (page: Page) => { const s = page.locator(".docpage").first(); await expect(s.locator("canvas")).toBeVisible({ timeout: 20_000 }); return s; };
const mark = async (page: Page) => {
  const b = await (await firstSheet(page)).boundingBox();
  await page.mouse.move(b.x + 60, b.y + 60); await page.mouse.down(); await page.mouse.move(b.x + 260, b.y + 140, { steps: 5 }); await page.mouse.up();
  await expect(page.locator(".docpage .box")).toHaveCount(1);
};
const finished = (page: Page) => expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 60_000 });
const add = (page: Page, file: string) => page.locator("#stage input[type=file]").first().setInputFiles(F(file));

test("replacing the file discards marks from the previous file", async ({ page }) => {
  await open(page, "redact-pdf", "a.pdf"); await mark(page);
  await page.evaluate(async () => { const r = await fetch("/favicon.svg"); void r; });
  await page.evaluate(async (bytes) => { const f = new File([new Uint8Array(bytes)], "b.pdf", { type: "application/pdf" }); await (window as any).__lathe.addFiles([f]); }, [...(await import("node:fs")).readFileSync(F("b.pdf"))]);
  await firstSheet(page);
  await expect(page.locator(".docpage .box")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__lathe.params.regions?.length ?? 0)).toBe(0);
});

test("reopening the editor after a run shows every mark it will apply", async ({ page }) => {
  await open(page, "redact-pdf", "a.pdf"); await mark(page);
  await go(page).click(); await finished(page);
  await page.locator(".tray button.file").first().click();
  await firstSheet(page);
  await expect(page.locator(".docpage .box")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__lathe.params.regions.length)).toBe(1);
});

test("a result can be checked at reading size and the marks come back", async ({ page }) => {
  await open(page, "redact-pdf", "a.pdf"); await mark(page);
  await go(page).click(); await finished(page);
  await page.getByRole("button", { name: "Check the result" }).click();
  await expect(page.locator(".docpage .box")).toHaveCount(0);
  await expect(page.locator(".docpage canvas").first()).toBeVisible({ timeout: 20_000 });
  expect((await page.locator(".docpage canvas").first().boundingBox()).width).toBeGreaterThan(300);
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(page.locator(".docpage .box")).toHaveCount(1);
});

test("files cannot change during a run", async ({ page }) => {
  await open(page, "compress-image", "photo.jpg");
  await page.evaluate(() => { const l = (window as any).__lathe; (window as any).__during = new Promise((res) => { const t = setInterval(() => { if (l.busy) { clearInterval(t); l.addFiles([new File([new Uint8Array(4)], "late.jpg", { type: "image/jpeg" })]); res(1); } }, 1); }); });
  await go(page).click(); await page.evaluate(() => (window as any).__during); await finished(page);
  await expect(page.locator(".tray .fname")).toHaveText(["photo.jpg"]);
  await expect(page.locator("#panel .results b").first()).toContainText("photo");
});

test("changing a setting labels the finished result as out of date", async ({ page }) => {
  await open(page, "compress-image", "photo.jpg");
  await go(page).click(); await finished(page);
  await expect(page.locator("#panel .results a[download]").first()).toHaveText("Download");
  await page.locator("#panel input[type=range]").first().fill("10");
  await expect(page.locator("#panel .results .stale")).toBeVisible();
  await expect(page.locator("#panel .results a[download]").first()).toHaveText("Download earlier version");
});

test("a run can be cancelled and the tool still works", async ({ page }) => {
  await open(page, "grayscale-pdf", "a.pdf");
  await go(page).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#panel .results a[download]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeHidden();
  await expect(go(page)).toBeEnabled();
  await go(page).click(); await finished(page);
  expect((await PDFDocument.load(await page.evaluate(() => Array.from((window as any).__lathe.outs[0].bytes as Uint8Array)).then((a) => new Uint8Array(a)))).getPageCount()).toBe(5);
});

test("removing the last file returns to the empty tool without a reload", async ({ page }) => {
  await open(page, "compress-image", "photo.jpg");
  await page.evaluate(() => { (window as any).__same = true; });
  await page.locator(".tray .x").first().click();
  await expect(page.locator("#stage .empty")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__same)).toBe(true);
  await page.locator("#stage input[type=file]").first().setInputFiles(F("photo2.jpg"));
  await expect(page.locator(".tray .fname")).toHaveText(["photo2.jpg"]);
});

test("files a tool cannot use are named", async ({ page }) => {
  await page.goto("/crop-image");
  await page.evaluate(() => (window as any).__lathe.addFiles([new File([new Uint8Array(4)], "one.jpg", { type: "image/jpeg" }), new File([new Uint8Array(4)], "two.jpg", { type: "image/jpeg" }), new File(["x"], "notes.txt", { type: "text/plain" })]));
  await expect(page.locator("#panel .notice")).toContainText("two.jpg");
  await expect(page.locator("#panel .notice")).toContainText("notes.txt");
});

for (const id of ["redact-pdf", "sign-pdf", "organize-pdf"]) test(`${id} explains a file it cannot open`, async ({ page }) => {
  await page.goto(`/${id}`);
  await page.evaluate(() => (window as any).__lathe.addFiles([new File(["not a pdf"], "broken.pdf", { type: "application/pdf" })]));
  await expect(page.locator("#stage .view")).toContainText(/cannot|damaged|password/i);
  await expect(go(page)).toBeDisabled();
});

const batch = (page: Page, names: string[]) => page.evaluate(async (list) => {
  const files = await Promise.all(list.map(async ([name, type, url]) => new File([url ? await (await fetch(url)).arrayBuffer() : new TextEncoder().encode("this is not a real file")], name, { type })));
  await (window as any).__lathe.addFiles(files);
}, names.map((n) => JSON.parse(n)));
const served = async (page: Page, file: string, type: string) => { await page.route(`**/__fixture/${file}`, (r) => r.fulfill({ path: F(file), contentType: type })); return JSON.stringify([file, type, `/__fixture/${file}`]); };

for (const [id, good, bad, type] of [["compress-image", "photo.jpg", "broken.jpg", "image/jpeg"], ["rotate-pdf", "a.pdf", "broken.pdf", "application/pdf"]]) test(`${id} keeps finished files when one fails`, async ({ page }) => {
  await page.goto(`/${id}`);
  await batch(page, [await served(page, good, type), JSON.stringify([bad, type, ""])]);
  await expect(page.locator(".tray .fname")).toHaveCount(2);
  await expect(go(page)).toBeEnabled({ timeout: 20_000 });
  await go(page).click();
  await expect(page.locator("#panel .results a[download]")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator("#panel .notice")).toContainText(bad);
  await expect(page.locator("#panel .notice")).toContainText("1 of 2");
});

test("a batch where every file fails explains why", async ({ page }) => {
  await page.goto("/compress-image");
  await batch(page, [JSON.stringify(["a.jpg", "image/jpeg", ""]), JSON.stringify(["b.jpg", "image/jpeg", ""])]);
  await expect(page.locator(".tray .fname")).toHaveCount(2);
  await expect(page.locator("#stage .view")).toContainText(/could not be read/i);
  await expect(go(page)).toBeEnabled();
  await go(page).click();
  await expect(page.locator("#panel .alert")).toContainText("a.jpg");
  await expect(page.locator("#panel .results a[download]")).toHaveCount(0);
});

test("a damaged first file does not block the rest of the batch", async ({ page }) => {
  await page.goto("/compress-image");
  await batch(page, [JSON.stringify(["broken.jpg", "image/jpeg", ""]), await served(page, "photo.jpg", "image/jpeg")]);
  await expect(page.locator("#stage .view")).toContainText(/could not be read/i);
  await expect(go(page)).toBeEnabled();
  await go(page).click();
  await expect(page.locator("#panel .results a[download]")).toHaveCount(1, { timeout: 60_000 });
});
