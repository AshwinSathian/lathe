// Names the service worker cache after the build, so each release replaces the engines it cached.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const hash = createHash("sha256");
const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (p !== join("dist", "sw.js")) hash.update(p).update(readFileSync(p)); } };
walk("dist");
const sw = readFileSync("dist/sw.js", "utf8");
if (!sw.includes('"lathe-dev"')) throw new Error("dist/sw.js has no cache name to stamp.");
writeFileSync("dist/sw.js", sw.replace('"lathe-dev"', `"lathe-${hash.digest("hex").slice(0, 12)}"`));
