import { tools, GROUPS } from "../data/tools";
import { docPages, docSections } from "../data/docs";
const site = "https://lathe.ashwinsathian.com";
export const GET = () => {
  const list = (kind: "image" | "pdf") => GROUPS[kind].map((g) => `### ${g}\n${tools.filter((t) => t.kind === kind && t.group === g).map((t) => `- [${t.name}](${site}/${t.id}): ${t.blurb}`).join("\n")}`).join("\n\n");
  const docs = docSections.map((g) => `### ${g}\n${docPages.filter((d) => d.section === g).map((d) => `- [${d.title}](${site}/docs/${d.slug}.md): ${d.description}`).join("\n")}`).join("\n\n");
  return new Response(`# Lathe\n\n> ${tools.length} free image and PDF tools that run entirely in the browser. Files are never uploaded, and no account is needed.\n\nProcessing uses WebAssembly, WebGL, WebCodecs and on-device AI models. AI models download once, after the user agrees. Removing a PDF password requires knowing it. HEIC export needs a browser with an HEVC encoder, such as Safari; HEIC import works in all modern browsers.\n\n## Image tools\n\n${list("image")}\n\n## PDF tools\n\n${list("pdf")}\n\n## Documentation\n\n${docs}\n\n## Optional\n\n- [Full reference in one file](${site}/llms-full.txt)\n- [How privacy works](${site}/privacy)\n- [Source code](https://github.com/AshwinSathian/lathe)\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
