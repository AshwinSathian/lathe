# Lathe: plan

Lathe is a private image and PDF workshop that runs entirely in the browser. Files never leave the tab.

**Intent.** A portfolio piece that pushes what a browser can do (as Wayfarer did), useful to anyone, and discoverable through search and AI answers.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Site | Astro static, one crawlable page per tool, Cloudflare Workers assets | Matches the other projects; each tool is a search landing page |
| App | Vanilla TypeScript islands, one registry drives pages, UI, JSON-LD, sitemap and llms.txt | No framework weight on first paint |
| Tool contract | `{ id, accepts, controls, run }`; one runner gives preview, batch, progress, download | Sixty tools cannot mean sixty UIs |
| Heavy work | Web Workers, engines loaded on first use | First paint carries no WASM |
| Image codecs | jSquash (MozJPEG, WebP, AVIF, JPEG XL, OxiPNG) | Apache-2.0, better output than canvas |
| HEIC read | libheif WASM (LGPL, loaded as a separate unmodified file) | Chrome and Firefox cannot decode HEIC |
| HEIC write | Browser HEVC encoder through WebCodecs plus our own HEIF container writer | Ships no HEVC encoder, so no x265 GPL and no encoder patent exposure. Unsupported browsers get a clear message |
| PDF | pdf-lib (edit), PDF.js (render, text), qpdf WASM (encrypt, decrypt, linearize, repair) | Permissive licences. MuPDF rejected: AGPL |
| AI | Transformers.js with WebGPU, WASM fallback; MediaPipe for faces; Tesseract for OCR | Models download once, need consent, then cache |
| Background model | BiRefNet-lite WebGPU build (MIT) on a GPU, MODNet (Apache-2.0) on CPU, both pinned by revision | Stock BiRefNet fails on WebGPU and exhausts WASM memory. RMBG is non-commercial; imgly and ISNet are AGPL |

## Honest limits, stated in the product

- Removing a PDF password requires that password.
- PDF to Word/Excel is left out: client-side output is poor.
- Redaction rasterises the page so the removed text is really gone.
- AI models are downloaded (never uploaded to); the first use asks first.

## Slices

1. Shell, registry, runner, design system, one image tool and one PDF tool, end to end.
2. Image tools: codecs, geometry, WebGL adjust, batch.
3. PDF tools: structure, security, stamping, conversion.
4. Interactive editors: crop, page organiser, sign, redact.
5. AI tools: background removal, upscale, OCR, face blur.
6. SEO, AEO, GEO: per-tool copy, JSON-LD, sitemap, llms.txt, OG cards.
7. PWA offline, CSP, accessibility, cross-browser test of every tool.

## Done means

Every registered tool runs against a real fixture in an automated browser test and produces a valid output.
