// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  site: "https://lathe.ashwinsathian.com",
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "always" },
  integrations: [sitemap()],
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
