// Search engines and AI answers should find a useful, distinct page for each conversion.
import { test, expect } from "./fixture";
import { tools } from "../src/data/tools";

const conversions = tools.filter((t) => t.run === "convert-image");
const text = (html: string) => (html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
const shingles = (s: string) => { const w = s.split(" "), o = new Set<string>(); for (let i = 0; i + 4 <= w.length; i++) o.add(w.slice(i, i + 4).join(" ")); return o; };

test("every conversion page has its own guidance and links to its neighbours", async ({ request }) => {
  const pages = await Promise.all(conversions.map(async (t) => ({ t, html: await (await request.get(`/${t.id}`)).text() })));
  const guides = new Set<string>();
  for (const { t, html } of pages) {
    expect(t.guide, t.id).toBeTruthy();
    expect(html, t.id).toContain(t.guide.replace(/&/g, "&amp;"));
    guides.add(t.guide);
    const links = conversions.filter((x) => x.id !== t.id && html.includes(`href="/${x.id}"`));
    expect(links.length, t.id).toBeGreaterThanOrEqual(3);
  }
  expect(guides.size).toBe(conversions.length);
  const sets = pages.map((p) => shingles(text(p.html))), scores: number[] = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) { let both = 0; for (const x of sets[i]) if (sets[j].has(x)) both++; scores.push(both / (sets[i].size + sets[j].size - both)); }
  scores.sort((a, b) => a - b);
  expect(scores[scores.length >> 1]).toBeLessThan(0.5);
});
test("the converter links to every conversion", async ({ request }) => {
  const html = await (await request.get("/convert-image")).text();
  for (const t of conversions) expect(html, t.id).toContain(`href="/${t.id}"`);
});
test("social cards are declared for every network", async ({ request }) => {
  const html = await (await request.get("/merge-pdf")).text();
  expect(html).toMatch(/<meta name="twitter:image" content="https:\/\/[^"]+og\.png"/);
});
