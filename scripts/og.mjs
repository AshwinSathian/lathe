// Draws one social card per tool into dist/og. The card states the tool and the promise, with nothing that can go stale.
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { tools } from "../src/data/tools.ts";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const wrap = (text, max) => { const lines = [""]; for (const w of text.split(" ")) { if ((`${lines.at(-1)} ${w}`).trim().length > max) lines.push(w); else lines[lines.length - 1] = `${lines.at(-1)} ${w}`.trim(); } return lines; };
mkdirSync("dist/og", { recursive: true });
for (const t of tools) {
  const title = wrap(t.name, 22).slice(0, 2), size = title.length > 1 ? 88 : 104, kicker = `${t.kind === "pdf" ? "PDF" : "Images"} / ${t.group}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b9ab4"/><stop offset=".45" stop-color="#eef2f7"/><stop offset="1" stop-color="#46566f"/></linearGradient></defs><rect width="1200" height="630" fill="#101b30"/><rect x="0" y="548" width="1200" height="82" fill="url(#s)" opacity=".92"/><rect x="930" y="548" width="72" height="82" fill="#c99a45"/><g font-family="Helvetica, Arial, sans-serif"><text x="72" y="104" font-size="34" font-weight="700" fill="#eef2f7">Lathe</text><text x="72" y="170" font-size="30" fill="#c99a45">${esc(kicker)}</text>${title.map((l, i) => `<text x="72" y="${290 + i * (size + 8)}" font-size="${size}" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join("")}<text x="72" y="508" font-size="32" fill="#c3cddd">Runs in your browser. Your file is never uploaded.</text></g></svg>`;
  await sharp(Buffer.from(svg)).png({ palette: true, quality: 80, compressionLevel: 9 }).toFile(`dist/og/${t.id}.png`);
}
