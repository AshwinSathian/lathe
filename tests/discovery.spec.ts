// Search engines and AI answers should find a useful, distinct page for each conversion.
import { test, expect } from "./fixture";
import { tools } from "../src/data/tools";
import { docLabels, docPages } from "../src/data/docs";

const conversions = tools.filter((t) => t.run === "convert-image");
const text = (html: string) => (html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? html).replace(/<script\b[\s\S]*?<\/script\b[^>]*>|<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
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
  expect(html).toMatch(/<meta name="twitter:image" content="https:\/\/[^"]+\/og\/merge-pdf\.png"/);
});

const site = "https://lathe.ashwinsathian.com";
const pageList = ["/", "/privacy", "/docs", ...docPages.map((d) => `/docs/${d.slug}`), ...tools.map((t) => `/${t.id}`)];
async function all(request: import("@playwright/test").APIRequestContext) {
  const out: { path: string; html: string }[] = [];
  for (let i = 0; i < pageList.length; i += 12) out.push(...await Promise.all(pageList.slice(i, i + 12).map(async (path) => { const r = await request.get(path); expect(r.status(), path).toBe(200); return { path, html: await r.text() }; })));
  return out;
}
const attr = (html: string, re: RegExp) => html.match(re)?.[1] ?? "";

test("every page has one H1, a unique title and description, and a correct canonical", async ({ request }) => {
  const pages = await all(request), titles = new Map<string, string>(), descs = new Map<string, string>();
  for (const { path, html } of pages) {
    expect((html.match(/<h1[\s>]/g) ?? []).length, path).toBe(1);
    const t = attr(html, /<title>([^<]+)<\/title>/), d = attr(html, /<meta name="description" content="([^"]+)"/);
    expect(t.length, `${path} title`).toBeGreaterThan(10); expect(t.length, `${path} title: ${t}`).toBeLessThanOrEqual(70);
    expect(d.length, `${path} description`).toBeGreaterThanOrEqual(70); expect(d.length, `${path} description`).toBeLessThanOrEqual(170);
    expect(titles.get(t), `${path} repeats a title`).toBeUndefined(); titles.set(t, path);
    expect(descs.get(d), `${path} repeats a description`).toBeUndefined(); descs.set(d, path);
    expect(html, path).toContain(`rel="canonical" href="${site}${path}"`);
  }
});
test("no internal link is broken and no page is an orphan", async ({ request }) => {
  const pages = await all(request), inbound = new Map(pageList.map((p) => [p, 0])), checked = new Map<string, number>();
  for (const { path, html } of pages) for (const m of html.matchAll(/<a [^>]*href="(\/[^"#?]*)/g)) {
    const to = m[1];
    if (!checked.has(to)) checked.set(to, (await request.get(to)).status());
    expect(checked.get(to), `${path} links to ${to}`).toBe(200);
    if (to !== path && inbound.has(to)) inbound.set(to, inbound.get(to) + 1);
  }
  expect([...inbound].filter(([p, n]) => p !== "/" && n === 0).map(([p]) => p)).toEqual([]);
});
test("structured data parses, links one entity graph and invents no social proof", async ({ request }) => {
  for (const { path, html } of await all(request)) {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(blocks.length, path).toBeGreaterThan(0);
    const text = JSON.stringify(blocks);
    expect(text, path).not.toMatch(/aggregateRating|"review"|ratingValue|userInteractionCount/);
    expect(text, path).toContain(`"@id":"${site}/#website"`);
    expect(text, path).toContain(`"@id":"${site}/#author"`);
  }
});
test("doc pages show a real date and declare it", async ({ request }) => {
  for (const d of docPages) {
    const html = await (await request.get(`/docs/${d.slug}`)).text(), date = attr(html, /<time datetime="(\d{4}-\d{2}-\d{2})"/);
    expect(date, d.slug).toMatch(/^20\d\d-/);
    expect(html, d.slug).toContain(`"dateModified":"${date}"`);
  }
});
test("every tool and doc has a Markdown version that the page declares", async ({ request }) => {
  for (const path of [...docPages.map((d) => `/docs/${d.slug}`), ...tools.map((t) => `/${t.id}`)]) {
    const r = await request.get(`${path}.md`); expect(r.status(), path).toBe(200);
    expect(r.headers()["content-type"], path).toContain("text/markdown");
    expect(await r.text(), path).toMatch(/^# /);
    expect(await (await request.get(path)).text(), path).toContain(`rel="alternate" type="text/markdown" href="${path}.md"`);
  }
});
test("llms files list the docs and tools", async ({ request }) => {
  const short = await (await request.get("/llms.txt")).text(), full = await (await request.get("/llms-full.txt")).text();
  for (const d of docPages) { expect(short, d.slug).toContain(`${site}/docs/${d.slug}.md`); expect(full, d.slug).toContain(d.title); }
  for (const t of tools) expect(full, t.id).toContain(t.name);
});
test("every tool has its own social card", async ({ request }) => {
  for (const t of tools) {
    const html = await (await request.get(`/${t.id}`)).text(), card = attr(html, /<meta property="og:image" content="([^"]+)"/);
    expect(card, t.id).toBe(`${site}/og/${t.id}.png`);
    const r = await request.get(`/og/${t.id}.png`); expect(r.status(), t.id).toBe(200); expect(r.headers()["content-type"]).toContain("image/png");
  }
});
test("the sitemap lists every page with a last-modified date", async ({ request }) => {
  const map = await (await request.get("/sitemap-0.xml")).text();
  for (const p of pageList) expect(map, p).toContain(`<loc>${site}${p}</loc><lastmod>20`);
});

test("every doc has a sidebar label", () => {
  for (const d of docPages) expect(docLabels[d.slug], d.slug).toBeTruthy();
});
