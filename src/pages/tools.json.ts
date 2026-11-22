import { tools } from "../data/tools";
export const GET = () => new Response(JSON.stringify(tools.map((t) => ({ id: t.id, name: t.name, kind: t.kind, group: t.group, blurb: t.blurb, accepts: t.accepts }))), { headers: { "Content-Type": "application/json" } });
