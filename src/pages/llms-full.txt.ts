import { docPages } from "../data/docs";
import { docMarkdown, SITE, version } from "../data/site";
import { GROUPS, tools } from "../data/tools";
export const GET = () => {
  const list = (kind: "image" | "pdf") => GROUPS[kind].map((g) => `### ${g}\n\n${tools.filter((t) => t.kind === kind && t.group === g).map((t) => `- **${t.name}** (${SITE}/${t.id}): ${t.blurb} ${t.guide ?? t.detail}`).join("\n")}`).join("\n\n");
  const docs = docPages.filter((d) => d.slug !== "tools").map((d) => `---\n\nSource: ${SITE}/docs/${d.slug}\nTitle: ${d.title}\n\n${docMarkdown(d)}`).join("\n\n");
  return new Response(`# Lathe, full reference (version ${version})\n\n> ${tools.length} free, open-source image and PDF tools that run entirely in the browser. Files are never uploaded.\n\n# Every Lathe tool and its engine\n\n## Tools: images\n\n${list("image")}\n\n## Tools: PDF\n\n${list("pdf")}\n\n# Documentation\n\n${docs}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
