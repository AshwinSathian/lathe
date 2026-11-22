import { docPages, type DocPage } from "../../data/docs";
import { docMarkdown } from "../../data/site";
export const getStaticPaths = () => docPages.map((d) => ({ params: { slug: d.slug }, props: { d } }));
export const GET = ({ props }: { props: { d: DocPage } }) => new Response(docMarkdown(props.d), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
