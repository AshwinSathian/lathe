// Build-time facts shared by page metadata: the entity graph, dates and rendered documentation.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { Marked } from "marked";
import { docPages, type DocPage } from "./docs";

export const SITE = "https://lathe.ashwinsathian.com";
const REPO = "https://github.com/AshwinSathian/lathe";
export const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const released = () => readFileSync("CHANGELOG.md", "utf8").match(/^## \[[\d.]+\] - (\d{4}-\d{2}-\d{2})/m)?.[1] ?? "";
/** The date a file last changed in git. Builds without history use the latest release date. */
export function lastChanged(file: string) {
  try { const d = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); if (d) return d; } catch { /* No git here, as in a Docker build. */ }
  return released();
}
export const AUTHOR = { "@id": `${SITE}/#author` }, WEBSITE = { "@id": `${SITE}/#website` };
/** The entities every page refers to, so search and AI systems connect the site, the project and its author. */
export const siteGraph = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${SITE}/#website`, name: "Lathe", url: `${SITE}/`, description: "Free, open-source image and PDF tools that run entirely in your browser.", inLanguage: "en", publisher: AUTHOR },
    { "@type": "Person", "@id": `${SITE}/#author`, name: "Ashwin Sathian", url: "https://github.com/AshwinSathian", sameAs: ["https://github.com/AshwinSathian"] },
    { "@type": "SoftwareSourceCode", "@id": `${SITE}/#source`, name: "Lathe", codeRepository: REPO, programmingLanguage: "TypeScript", license: "https://opensource.org/licenses/MIT", version, author: AUTHOR },
  ],
};

const fileToSlug = new Map(docPages.map((d) => [d.file, d.slug]));
function target(href: string, from: string, ext = "") {
  if (href.startsWith(`${SITE}/`)) return ext ? href : href.slice(SITE.length);
  if (/^[a-z]+:|^#/i.test(href)) return href;
  const [path, hash] = href.split("#"), file = normalize(join(dirname(from), path)), slug = fileToSlug.get(file), tail = hash ? `#${hash}` : "";
  if (slug) return ext ? `${SITE}/docs/${slug}${ext}${tail}` : `/docs/${slug}${tail}`;
  return `${REPO}/blob/main/${file}${tail}`;
}
const idOf = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function renderDoc(d: DocPage) {
  const toc: { id: string; text: string }[] = [], qa: { q: string; a: string }[] = [], md = readFileSync(d.file, "utf8");
  const parser = new Marked({ gfm: true, renderer: {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens), id = idOf(html);
      if (depth === 2) toc.push({ id, text: html.replace(/<[^>]+>/g, "") });
      return depth === 1 ? `<h1>${html}</h1>\n` : `<h${depth} id="${id}">${html}</h${depth}>\n`;
    },
    link({ href, tokens }) {
      const to = target(href, d.file), outside = /^https?:/.test(to);
      return `<a href="${to}"${outside ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
    },
    code({ text, lang }) {
      if (lang === "mermaid") return `<p class="doc-note">The flow diagram for this section is in the <a href="${REPO}/blob/main/${d.file}" rel="noopener">repository version of this page</a>.</p>\n`;
      return `<pre><code>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre>\n`;
    },
  } });
  const html = (parser.parse(md) as string).replace(/<table>/g, '<div class="doc-table"><table>').replace(/<\/table>/g, "</table></div>");
  if (d.slug === "faq") for (const m of md.matchAll(/^### (.+)\n\n([\s\S]+?)(?=\n#{2,3} |$(?![\s\S]))/gm)) qa.push({ q: m[1], a: m[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`]/g, "").trim() });
  return { html, toc, qa, modified: lastChanged(d.file) };
}
/** The Markdown with links that work outside this repository. */
export const docMarkdown = (d: DocPage) => readFileSync(d.file, "utf8").replace(/\]\(([^)\s]+)\)/g, (_, href) => `](${target(href, d.file, ".md").replace(/^\//, `${SITE}/`)})`);
