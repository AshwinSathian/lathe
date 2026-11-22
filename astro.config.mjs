// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

// Each sitemap date comes from the source file that page is built from.
const changed = (file) => { try { return execFileSync("git", ["log", "-1", "--format=%cI", "--", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined; } catch { return undefined; } };
const sourceOf = (path) => (path === "/" ? "src/pages/index.astro" : path === "/privacy" ? "src/pages/privacy.astro" : path === "/docs" ? "docs" : path.startsWith("/docs/") && existsSync(`${path.slice(1)}.md`) ? `${path.slice(1)}.md` : "src/data/tools.ts");
const fallback = new Date().toISOString();

export default defineConfig({
  site: "https://lathe.ashwinsathian.com",
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "always" },
  integrations: [sitemap({ serialize: (item) => ({ ...item, lastmod: changed(sourceOf(new URL(item.url).pathname.replace(/\/$/, "") || "/")) ?? fallback }) })],
  server: { headers: isolation },
  vite: {
    worker: { format: "es" },
    build: { assetsInlineLimit: 0, target: "es2022", chunkSizeWarningLimit: 4000 },
    // These packages locate their .wasm through import.meta.url, which pre-bundling breaks.
    optimizeDeps: {
      exclude: ["@jsquash/avif", "@jsquash/webp", "@jsquash/jpeg", "@jsquash/png", "@jsquash/jxl", "@jsquash/oxipng", "@neslinesli93/qpdf-wasm", "@huggingface/transformers", "pdfjs-dist"],
    },
  },
});
