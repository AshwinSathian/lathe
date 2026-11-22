// The page's side of the engine: one worker, plus the few jobs that need the main thread.
import type { In, Out } from "../engine/core";

let worker: Worker;
let nextJob = 1;
const jobs = new Map<number, { res: (o: any) => void; rej: (e: Error) => void; onProgress?: (p: number, label?: string) => void }>();

function engine() {
  if (worker) return worker;
  const w = worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
  w.onmessage = async ({ data: m }) => {
    if (m.t === "call") {
      try {
        const result = await OPS[m.op](m.args, (got: number, total: number) => w.postMessage({ t: "callProgress", id: m.id, got, total }));
        const transfer = result instanceof ImageBitmap || result instanceof ArrayBuffer ? [result] : Array.isArray(result) && result[0] instanceof ImageBitmap ? result : [];
        w.postMessage({ t: "reply", id: m.id, result }, { transfer });
      } catch (e) { w.postMessage({ t: "reply", id: m.id, error: (e as Error).message }); }
      return;
    }
    const j = jobs.get(m.job);
    if (!j) return;
    if (m.t === "progress") j.onProgress?.(m.p, m.label);
    else { jobs.delete(m.job); if (m.t === "done") j.res(m.outs); else j.rej(new Error(m.error)); }
  };
  w.onerror = (e) => { for (const j of jobs.values()) j.rej(new Error(e.message || "The engine stopped. The file may be too large for this device.")); jobs.clear(); worker = null; };
  return worker;
}

/** Stops everything the engine is doing. The next job starts a fresh worker. */
export function cancelJobs() {
  worker?.terminate(); worker = null;
  const stopped = Object.assign(new Error("Cancelled"), { name: "AbortError" });
  for (const j of jobs.values()) j.rej(stopped);
  jobs.clear();
}

export const runTool = (tool: string, files: In[], params: any, opts: { preview?: boolean; onProgress?: (p: number, label?: string) => void } = {}) => new Promise<Out[]>((res, rej) => {
  const job = nextJob++;
  jobs.set(job, { res, rej, onProgress: opts.onProgress });
  engine().postMessage({ t: "run", job, tool, files, params, preview: opts.preview });
});
export const pdfFields = (file: In) => new Promise<any[]>((res, rej) => { const job = nextJob++; jobs.set(job, { res, rej }); engine().postMessage({ t: "fields", job, file }); });

// PDF.js keeps its own worker, so rendering here does not block the page.
const docs = new Map<string, Promise<any>>();
let pdfjs: Promise<any>;
export function openPdf(key: string, blob: Blob) {
  const id = `${key}:${blob.size}`;
  if (!docs.has(id)) {
    pdfjs ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([lib, url]) => { lib.GlobalWorkerOptions.workerSrc = url.default; return lib; });
    docs.set(id, (async () => {
      const lib = await pdfjs, data = new Uint8Array(await blob.arrayBuffer());
      return lib.getDocument({ data, standardFontDataUrl: "/vendor/pdfjs/standard_fonts/", cMapUrl: "/vendor/pdfjs/cmaps/", cMapPacked: true, wasmUrl: "/vendor/pdfjs/wasm/", iccUrl: "/vendor/pdfjs/iccs/", isEvalSupported: false }).promise;
    })());
    if (docs.size > 8) docs.delete(docs.keys().next().value);
  }
  return docs.get(id);
}
export async function renderPage(doc: any, index: number, scale: number, gray = false) {
  const page = await doc.getPage(index + 1), vp = page.getViewport({ scale }), c = document.createElement("canvas");
  c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
  const g = c.getContext("2d", { alpha: false, willReadFrequently: gray });
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
  if (gray) {
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    g.putImageData(im, 0, 0);
  }
  return c;
}

let faces: Promise<any>;
async function detectFaces({ bitmap, confidence }: { bitmap: ImageBitmap; confidence: number }) {
  faces ??= (async () => {
    const { FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = { wasmLoaderPath: "/vendor/mediapipe/vision_wasm_internal.js", wasmBinaryPath: "/vendor/mediapipe/vision_wasm_internal.wasm" };
    return FaceDetector.createFromOptions(fileset as any, { baseOptions: { modelAssetPath: "/vendor/mediapipe/blaze_face_short_range.tflite" }, runningMode: "IMAGE", minDetectionConfidence: 0.3 });
  })();
  const det = await faces;
  det.setOptions({ minDetectionConfidence: confidence });
  const W = bitmap.width, H = bitmap.height, found: { x: number; y: number; w: number; h: number; s: number }[] = [];
  // The detector works at low resolution, so overlapping tiles catch small faces in group shots.
  const views: number[][] = [[0, 0, W, H]];
  for (const n of Math.max(W, H) > 700 ? [2, 3] : [2]) { const tw = W / (n * 0.75 + 0.25), th = H / (n * 0.75 + 0.25); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) views.push([x * tw * 0.75, y * th * 0.75, tw, th]); }
  const c = document.createElement("canvas"), g = c.getContext("2d");
  for (const [x, y, w, h] of views) {
    c.width = Math.round(w); c.height = Math.round(h); g.drawImage(bitmap, x, y, w, h, 0, 0, c.width, c.height);
    for (const d of det.detect(c).detections) { const b = d.boundingBox; found.push({ x: x + b.originX, y: y + b.originY, w: b.width, h: b.height, s: d.categories[0]?.score ?? 0 }); }
  }
  const keep: typeof found = [];
  for (const f of found.sort((a, b) => b.s - a.s)) {
    const overlaps = keep.some((k) => { const iw = Math.min(f.x + f.w, k.x + k.w) - Math.max(f.x, k.x), ih = Math.min(f.y + f.h, k.y + k.h) - Math.max(f.y, k.y); return iw > 0 && ih > 0 && (iw * ih) / Math.min(f.w * f.h, k.w * k.h) > 0.4; });
    if (!overlaps) keep.push(f);
  }
  bitmap.close();
  return keep;
}

const ocrWorkers = new Map<string, Promise<any>>();
async function ocr({ bitmap, lang }: { bitmap: ImageBitmap; lang: string }) {
  if (!ocrWorkers.has(lang)) ocrWorkers.set(lang, import("tesseract.js").then(({ createWorker }) => createWorker(lang, 1, { workerPath: "/vendor/tesseract/worker.min.js", corePath: "/vendor/tesseract/", langPath: "/vendor/tessdata", cacheMethod: "none", workerBlobURL: false })));
  const w = await ocrWorkers.get(lang), c = document.createElement("canvas");
  c.width = bitmap.width; c.height = bitmap.height; c.getContext("2d").drawImage(bitmap, 0, 0); bitmap.close();
  const { data } = await w.recognize(c, {}, { text: true, blocks: true });
  const words = (data.blocks ?? []).flatMap((b: any) => b.paragraphs.flatMap((p: any) => p.lines.flatMap((l: any) => l.words.map((x: any) => ({ text: x.text, ...x.bbox })))));
  return { text: data.text as string, words };
}

async function rasterSvg({ text }: { text: string }) {
  // Parsed and re-serialised without scripts; drawn through <img>, which cannot run them or load anything.
  const doc = new DOMParser().parseFromString(text, "image/svg+xml"), svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg") throw new Error("This SVG could not be read.");
  doc.querySelectorAll("script, foreignObject").forEach((x) => x.remove());
  const vb = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number), wa = parseFloat(svg.getAttribute("width") ?? ""), ha = parseFloat(svg.getAttribute("height") ?? "");
  let w = /%/.test(svg.getAttribute("width") ?? "") ? 0 : wa, h = /%/.test(svg.getAttribute("height") ?? "") ? 0 : ha;
  if (!w || !h) { w = vb?.[2] || 1024; h = vb?.[3] || 1024; }
  const k = Math.max(w, h) < 1024 ? 1024 / Math.max(w, h) : 1;
  svg.setAttribute("width", String(Math.round(w * k))); svg.setAttribute("height", String(Math.round(h * k)));
  if (!vb) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" })), img = new Image();
  try { img.src = url; await img.decode(); return await createImageBitmap(img, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k) }); } finally { URL.revokeObjectURL(url); }
}

// The engine worker holds your files and has no third-party network access. Only the page on a model tool can fetch,
// and only these two hosts. The worker checks every file's SHA-256 before using it.
async function fetchPinned({ url, integrity }: { url: string; integrity?: string }, progress: (got: number, total: number) => void) {
  if (!/^https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//.test(url)) throw new Error("Blocked a download from an unexpected address.");
  const r = await fetch(url, integrity ? { integrity } : {});
  if (!r.ok) throw new Error(`Model download failed (${r.status}).`);
  const total = +(r.headers.get("content-length") ?? 0), reader = r.body.getReader(), parts: Uint8Array[] = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; progress(got, total); }
  const out = new Uint8Array(got); let at = 0;
  for (const x of parts) { out.set(x, at); at += x.length; }
  return out.buffer;
}
const OPS: Record<string, (a: any, progress?: (got: number, total: number) => void) => Promise<any>> = {
  fetchPinned,
  pageCount: async ({ doc, key }) => (await openPdf(key, doc)).numPages,
  async render({ doc, key, page, dpi, gray }) { const d = await openPdf(key, doc), c = await renderPage(d, page, dpi / 72, gray); return createImageBitmap(c); },
  async text({ doc, key, page }) {
    const d = await openPdf(key, doc), pg = await d.getPage(page + 1), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    return tc.items.filter((x: any) => "str" in x).map((x: any) => { const [a, b, , , e, f] = mul(vp.transform, x.transform); return { str: x.str, x: e, y: vp.height - f, w: x.width, h: Math.hypot(a, b) || x.height }; });
  },
  async images({ doc, key, page, minSize }) {
    const d = await openPdf(key, doc), pg = await d.getPage(page + 1), { OPS: O } = await pdfjs, ops = await pg.getOperatorList(), out: ImageBitmap[] = [], seen = new Set<string>();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== O.paintImageXObject) continue;
      const name = ops.argsArray[i][0]; if (seen.has(name)) continue; seen.add(name);
      const im: any = await new Promise((r) => (name.startsWith("g_") ? pg.commonObjs : pg.objs).get(name, r));
      if (!im || Math.max(im.width, im.height) < minSize) continue;
      if (im.bitmap) { out.push(await createImageBitmap(im.bitmap)); continue; }
      if (!im.data) continue;
      const n = im.width * im.height, rgba = new Uint8ClampedArray(n * 4), ch = im.data.length / n;
      for (let k = 0; k < n; k++) { rgba[k * 4] = im.data[k * ch]; rgba[k * 4 + 1] = im.data[k * ch + (ch >= 3 ? 1 : 0)]; rgba[k * 4 + 2] = im.data[k * ch + (ch >= 3 ? 2 : 0)]; rgba[k * 4 + 3] = ch === 4 ? im.data[k * 4 + 3] : 255; }
      out.push(await createImageBitmap(new ImageData(rgba, im.width, im.height)));
    }
    return out;
  },
  faces: detectFaces, ocr, rasterSvg,
};
const mul = (m: number[], n: number[]) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

// Hands files from one page to the next through IndexedDB, then deletes them.
const db = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("lathe", 1); r.onupgradeneeded = () => r.result.createObjectStore("handoff"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
// Plain buffers, because Safari's private mode refuses to store File objects.
// Encrypted, with the key in this tab's sessionStorage, so a crash or closed tab leaves nothing readable behind.
const KEY = "lathe:handoff-key";
const seal = async (key: CryptoKey, data: ArrayBuffer | Uint8Array<ArrayBuffer>) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, data: await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data) }; };
export async function stash(files: File[]) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const items = await Promise.all(files.map(async (f) => ({ meta: await seal(key, new TextEncoder().encode(JSON.stringify({ name: f.name, type: f.type, lastModified: f.lastModified }))), body: await seal(key, await f.arrayBuffer()) })));
  sessionStorage.setItem(KEY, btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("raw", key)))));
  const d = await db();
  await new Promise((res, rej) => { const t = d.transaction("handoff", "readwrite"); t.objectStore("handoff").put(items, "files"); t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
  d.close();
}
export async function clearStash() { sessionStorage.removeItem(KEY); const d = await db(); await new Promise((res) => { const t = d.transaction("handoff", "readwrite"); t.objectStore("handoff").delete("files"); t.oncomplete = t.onerror = t.onabort = res; }); d.close(); }
export async function unstash(): Promise<File[]> {
  // Read first: the page shell clears leftovers as it starts, and must not take the key of a live handoff.
  const raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
  const d = await db();
  const items = await new Promise<any[]>((res, rej) => { const t = d.transaction("handoff", "readwrite"), s = t.objectStore("handoff"), g = s.get("files"); g.onsuccess = () => { s.delete("files"); }; t.oncomplete = () => res(g.result ?? []); t.onerror = t.onabort = () => rej(t.error); });
  d.close();
  if (!raw || !items.length) return [];
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
  const open = (x: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }) => crypto.subtle.decrypt({ name: "AES-GCM", iv: x.iv }, key, x.data);
  const files = await Promise.all(items.map(async (x) => { const m = JSON.parse(new TextDecoder().decode(await open(x.meta))); return new File([await open(x.body)], m.name, { type: m.type, lastModified: m.lastModified }); }));
  return files;
}
