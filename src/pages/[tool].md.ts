import { tools, type Tool } from "../data/tools";
import { docPages, toolGuides } from "../data/docs";
import { SITE } from "../data/site";
export const getStaticPaths = () => tools.map((t) => ({ params: { tool: t.id }, props: { t } }));
export const GET = ({ props: { t } }: { props: { t: Tool } }) => {
  const guide = docPages.find((d) => d.slug === toolGuides[t.id]);
  const text = `# ${t.name}\n\n${t.blurb}\n\n${t.detail}\n\n${t.guide ? `${t.guide}\n\n` : ""}- Open the tool: ${SITE}/${t.id}\n- Category: ${t.kind === "pdf" ? "PDF" : "Images"}, ${t.group}\n- Runs on: ${t.tech}\n- Files uploaded: none. It runs in your browser\n- Cost: free, with no account or watermark\n${t.model ? `- Model download: ${t.model.name}, ${t.model.size}, after you agree\n` : ""}${guide ? `- Guide: ${SITE}/docs/${guide.slug}.md\n` : ""}- Limits: ${SITE}/docs/limits.md\n`;
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
