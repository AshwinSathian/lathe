// Text must arrive exactly as written, or the tool must refuse and say which characters it cannot set.
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { test, expect, type Page } from "./fixture";

const go = (page: Page) => page.locator("#panel > .btn").first();
async function markdown(page: Page, text: string) {
  await page.goto("/markdown-to-pdf");
  await page.locator("#panel textarea").first().fill(text);
  await expect(go(page)).toBeEnabled(); await go(page).click();
  await expect(page.locator("#panel .results h2, #panel .alert").first()).toBeVisible({ timeout: 30_000 });
  const alert = (await page.locator("#panel .alert").allTextContents()).join("");
  if (alert) return { alert, bytes: Buffer.alloc(0), words: [] as { s: string; on: boolean }[] };
  const b64 = await page.evaluate(() => { const b = (window as any).__lathe.outs[0].bytes; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); });
  return { alert, bytes: Buffer.from(b64, "base64"), words: await read(page, b64) };
}
// Markdown to PDF has no PDF preview, so the reader is borrowed from a tool page that loads PDF.js.
const read = async (page: Page, b64: string) => {
  const reader = await page.context().newPage();
  await reader.goto("/organize-pdf");
  await reader.locator("#stage input[type=file]").first().setInputFiles("tests/fixtures/a.pdf");
  await reader.locator(".pg canvas").first().waitFor({ timeout: 20_000 });
  const out = await reader.evaluate(async (data64) => {
    const pdfjs: any = await import(/* @vite-ignore */ (performance.getEntriesByType("resource") as any[]).map((r) => r.name).find((n) => /\/pdf[-.][^/]*\.js$/.test(n) && !/worker/.test(n)) ?? "");
    pdfjs.GlobalWorkerOptions.workerSrc ||= (performance.getEntriesByType("resource") as any[]).map((r) => r.name).find((n) => /pdf\.worker/.test(n));
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(data64), (c) => c.charCodeAt(0)) }).promise, found: { s: string; on: boolean }[] = [];
    for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }); for (const it of (await pg.getTextContent()).items as any[]) if (it.str?.trim()) { const [x] = vp.convertToViewportPoint(it.transform[4] + it.width, it.transform[5]); found.push({ s: it.str, on: x <= vp.width + 1 }); } }
    return found;
  }, b64);
  await reader.close();
  return out;
};
const joined = (w: { s: string }[]) => w.map((x) => x.s).join(" ").replace(/\s+/g, " ");

for (const [script, sample, shown] of [["Hindi", "नमस्ते", "न"], ["Chinese", "你好", "你"], ["Arabic", "مرحبا", "م"], ["Polish", "Łódź", "Ł"]]) test(`Markdown refuses ${script} and names the characters`, async ({ page }) => {
  const r = await markdown(page, `# Title\n\nHello ${sample}`);
  expect(r.alert).toContain(shown);
  await expect(page.locator("#panel .results a[download]")).toHaveCount(0);
});
test("Markdown keeps accents and typographic characters", async ({ page }) => {
  const { words, alert } = await markdown(page, "Café naïve cœur €100 “quoted” – dash");
  expect(alert).toBe("");
  for (const t of ["Café", "naïve", "cœur", "€100", "“quoted”", "–"]) expect(joined(words)).toContain(t);
});
test("Markdown draws strikethrough", async ({ page }) => {
  const { bytes } = await markdown(page, "The tenant is ~~not~~ liable");
  const d = await PDFDocument.load(bytes), c: any = d.getPage(0).node.Contents(), st = d.context.lookup(c.get ? c.get(0) : c) as any;
  const raw = st.getContents?.() ?? st.contents; let text: string;
  try { text = inflateSync(Buffer.from(raw)).toString("latin1"); } catch { text = Buffer.from(raw).toString("latin1"); }
  expect(text).toMatch(/\bl\s*\n?\s*S\b/);
});
test("Markdown wraps a long table cell instead of cutting it", async ({ page }) => {
  const { words } = await markdown(page, "| Clause | Amount |\n|---|---|\n| 4.1 | The total amount payable is ONE MILLION RUPEES ONLY and nothing further |\n");
  expect(joined(words)).toContain("ONE MILLION RUPEES ONLY and nothing further".split(" ").slice(0, 2).join(" "));
  for (const t of ["MILLION", "RUPEES", "further"]) expect(joined(words)).toContain(t);
  expect(words.every((w) => w.on)).toBe(true);
});
test("Markdown breaks a very long word inside the page", async ({ page }) => {
  const { words } = await markdown(page, `Start ${"verylongword".repeat(30)} end`);
  expect(words.every((w) => w.on)).toBe(true);
  expect(joined(words).replace(/ /g, "")).toContain("verylongword".repeat(30));
});
test("Markdown keeps raw HTML, task state, list numbering and footnotes", async ({ page }) => {
  const { words } = await markdown(page, "<div>RAWHTML</div>\n\n- [x] done item\n- [ ] open item\n\n0. zero\n1. one\n\nNote[^1]\n\n[^1]: FOOTNOTEBODY\n");
  const t = joined(words);
  for (const x of ["RAWHTML", "[x] done", "[ ] open", "0.", "FOOTNOTEBODY"]) expect(t).toContain(x);
});
test("Fill PDF refuses text its font cannot show and names the field", async ({ page }) => {
  const d = await PDFDocument.create(), pg = d.addPage([400, 400]), f = d.getForm().createTextField("full.name"); f.addToPage(pg, { x: 40, y: 200, width: 200, height: 30 });
  await page.goto("/fill-pdf");
  await page.locator("#stage input[type=file]").first().setInputFiles({ name: "form.pdf", mimeType: "application/pdf", buffer: Buffer.from(await d.save()) });
  await expect(go(page)).toBeEnabled({ timeout: 20_000 });
  await page.waitForFunction(() => !!(window as any).__lathe.params.values);
  await page.evaluate(() => { (window as any).__lathe.params.values["full.name"] = "नमस्ते Łukasz"; });
  await go(page).click();
  await expect(page.locator("#panel .alert")).toContainText("full.name");
  await expect(page.locator("#panel .alert")).toContainText("Ł");
});
