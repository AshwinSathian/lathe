import type { Control, Tool } from "../data/tools";
import type { In, Out } from "../engine/core";
import { cancelJobs, openPdf, renderPage, runTool, stash, unstash } from "./client";
import { addBox, announcer, cropEditor, el, formFields, pageMarkup, pagesEditor, regionSurface, signaturePanel, type Box, type Rect } from "./editors";

const bench = document.querySelector<HTMLElement>("#bench"), stage = document.querySelector<HTMLElement>("#stage"), panel = document.querySelector<HTMLElement>("#panel");
const tool: Tool = JSON.parse(bench.dataset.tool);
const engineId = tool.run ?? tool.id;
const storeKey = `lathe:settings:${engineId}`;

let saved: Record<string, unknown> = {};
try { saved = JSON.parse(localStorage.getItem(storeKey) ?? "{}"); } catch { /* Private windows can refuse storage. */ }
const params: Record<string, any> = {};
// Only choices are remembered. Anything typed could name a person or a document.
const remembered = (c: Control) => ["range", "select", "toggle", "color"].includes(c.type) && c.k !== "flattenAll";
for (const c of tool.controls) params[c.k] = remembered(c) ? saved[c.k] ?? ("def" in c ? c.def : "") : "def" in c ? c.def ?? "" : "";
Object.assign(params, tool.preset);
// The redaction safety setting always starts on, so one relaxed document cannot weaken the next.
const remember = () => { try { const o: Record<string, unknown> = {}; for (const c of tool.controls) if (remembered(c)) o[c.k] = params[c.k]; localStorage.setItem(storeKey, JSON.stringify(o)); } catch { /* Settings just will not persist. */ } };

let files: In[] = [], current = 0, outs: (Out & { url?: string })[] = [], busy = false, consented = !tool.model;
let uid = 0, previewTimer = 0, previewBusy = false, previewAgain = false, changedDuringRun = false;
let leaveResult: (() => void) | null = null;
const boxes: Box[] = [];
let pagesApi: { append(next?: In[]): Promise<void> }, pagesFiles = 0, pagesIds: string[] = [];
const pagesKept = () => pagesIds.every((id, i) => files[i]?.id === id);
let signature: { png: Uint8Array; url: string; ratio: number } | null = null, cropApi: { applyAspect(): void };

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(n < 104857600 ? 2 : 1)} MB`);
const say = (m: string) => { live.textContent = m; };
const live = el("div", { className: "vh", role: "status" });

/* Controls */
const controlsHost = el("div", { className: "controls", style: "display:grid;gap:14px;align-content:start" });
const refreshVisible = () => controlsHost.querySelectorAll<HTMLElement>("[data-when]").forEach((n) => {
  const w = JSON.parse(n.dataset.when); n.hidden = !Object.entries(w).every(([k, v]) => (Array.isArray(v) ? v.includes(params[k]) : params[k] === v));
  n.style.display = n.hidden ? "none" : "";
});
const touched = () => { remember(); refreshVisible(); schedulePreview(); };
function control(c: Control) {
  const id = `c-${c.k}`; let n: HTMLElement;
  if (c.type === "range") {
    const o = el("output", { htmlFor: id }), i = el("input", { id, type: "range", min: String(c.min), max: String(c.max), step: String(c.step), value: String(params[c.k]) });
    const show = () => { o.textContent = `${+(+i.value).toFixed(c.step < 1 ? (c.step < 0.1 ? 2 : 1) : 0)}${c.unit ?? ""}`; i.style.setProperty("--fill", `${((+i.value - c.min) / (c.max - c.min)) * 100}%`); };
    i.oninput = () => { params[c.k] = +i.value; show(); touched(); };
    i.ondblclick = () => { i.value = String(c.def); params[c.k] = c.def; show(); touched(); };
    show(); n = el("div", { className: "field" }, el("label", { htmlFor: id }, c.label, o), i);
  } else if (c.type === "select") {
    const i = el("select", { id }, ...c.options.map(([v, l]) => el("option", { value: v, textContent: l, selected: v === params[c.k] })));
    i.onchange = () => { params[c.k] = i.value; touched(); if (c.k === "aspect") cropApi?.applyAspect(); };
    n = el("div", { className: "field" }, el("label", { htmlFor: id, textContent: c.label }), i);
  } else if (c.type === "toggle") {
    const i = el("input", { type: "checkbox", checked: !!params[c.k] }); i.onchange = () => { params[c.k] = i.checked; touched(); };
    n = el("label", { className: "check" }, c.label, i);
  } else if (c.type === "color") {
    const i = el("input", { id, type: "color", value: params[c.k] }), t = el("input", { type: "text", value: params[c.k], "aria-label": `${c.label} hex value`, spellcheck: false });
    i.oninput = () => { t.value = params[c.k] = i.value; touched(); };
    t.onchange = () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { i.value = params[c.k] = t.value.toLowerCase(); touched(); } else t.value = params[c.k]; };
    n = el("div", { className: "field" }, el("label", { htmlFor: id, textContent: c.label }), el("div", { className: "colorrow" }, i, t));
  } else if (c.type === "textarea") {
    const i = el("textarea", { id, value: params[c.k], placeholder: c.placeholder ?? "", spellcheck: true }); i.oninput = () => { params[c.k] = i.value; };
    n = el("div", { className: "field" }, el("label", { htmlFor: id, textContent: c.label }), i);
  } else {
    const i = el("input", { id, type: c.type, value: params[c.k] ?? "", placeholder: c.placeholder ?? "", autocomplete: c.type === "password" ? "new-password" : "off", spellcheck: false }); i.oninput = () => { params[c.k] = i.value; touched(); };
    n = el("div", { className: "field" }, el("label", { htmlFor: id, textContent: c.label }), i);
  }
  if (c.when) n.dataset.when = JSON.stringify(c.when);
  return n;
}
const shown = tool.controls.filter((c) => !(tool.preset && c.k in tool.preset));
controlsHost.append(...shown.map(control));
refreshVisible();

/* Panel */
const extra = el("div", { style: "display:grid;gap:12px" });
// The button says what it will do. Tool names that are already a verb phrase stay as they are.
const ACTIONS: Record<string, string> = { "adjust-image": "Save photo", "filter-image": "Save photo", "frame-image": "Save image", "redact-pdf": "Apply redactions", "sign-pdf": "Sign and save", "fill-pdf": "Save filled PDF", "pdf-metadata": "Save PDF", "inspect-pdf": "Inspect PDF", "view-metadata": "Show metadata" };
const actionLabel = ACTIONS[tool.id] ?? tool.name;
const go = el("button", { className: "btn", type: "button", textContent: actionLabel, disabled: !tool.noInput });
const stop = el("button", { className: "btn alt small", type: "button", textContent: "Cancel" });
stop.onclick = cancelJobs;
const prog = el("div", { className: "progress" }, el("div", { className: "meter", role: "progressbar", "aria-label": "Progress", "aria-valuemin": 0, "aria-valuemax": 100 }, el("i")), el("span"), stop);
const msg = el("div", { "aria-live": "polite" });
const notice = el("div", { className: "notice ok", "aria-live": "polite", hidden: true });
const results = el("div", { className: "results" });
const consent = tool.model ? el("div", { className: "consent" }, el("span", { textContent: `This tool runs ${tool.model.name} on your device. The first use downloads about ${tool.model.size}. Your file is not sent anywhere.` })) : null;
panel.append(live, extra, controlsHost);
announcer.say = (m) => say(m);
const ranges = shown.filter((c) => c.type === "range");
if (ranges.length >= 4) {
  const reset = el("button", { className: "btn alt small", type: "button", textContent: "Reset all" });
  reset.onclick = () => { for (const c of ranges) { const i = controlsHost.querySelector<HTMLInputElement>(`#c-${c.k}`); if (i) { i.value = String((c as { def: number }).def); i.dispatchEvent(new Event("input", { bubbles: true })); } } };
  controlsHost.append(reset);
}
if (consent) panel.append(consent);
panel.append(go, prog, notice, msg, results);
// Any change to a setting makes a finished result out of date.
for (const type of ["input", "change"]) panel.addEventListener(type, () => markStale());
if (tool.model) { try { consented = localStorage.getItem(`lathe:model:${tool.model.name}`) === "1"; } catch { /* Ask again next time. */ } if (consented) consent.hidden = true; else go.textContent = `Download model and run`; }

const setProgress = (p: number, label = "") => { const pct = Math.round(p * 100); prog.style.setProperty("--p", String(p)); prog.querySelector<HTMLElement>("i").style.setProperty("--p", String(p)); prog.querySelector(".meter").setAttribute("aria-valuenow", String(pct)); prog.querySelector("span").textContent = label; };
const showError = (m: string) => { msg.className = "alert"; msg.textContent = m; say(m); };
const clearMsg = () => { msg.className = ""; msg.textContent = ""; };
const setNotice = (m: string) => { notice.textContent = m; notice.hidden = !m; };
const syncMarks = () => {
  if (tool.editor === "regions") params.regions = boxes.map(({ page, x, y, w, h }) => ({ page, x, y, w, h }));
  if (tool.editor === "sign") { params.placements = boxes.map(({ page, x, y, w, h, png }) => ({ page, x, y, w, h, png })); go.disabled = busy || !ready(); }
  markStale();
};
function markStale() {
  if (busy) { changedDuringRun = true; return; }
  if (!outs.length || results.querySelector(".stale")) return;
  results.prepend(el("p", { className: "stale alert", role: "status", textContent: "Made before your latest change. Run again to update it." }));
  results.querySelectorAll("a[download]").forEach((a) => (a.textContent = "Download earlier version"));
  results.querySelectorAll<HTMLButtonElement>("button.zip").forEach((b) => (b.textContent = "Download earlier versions as ZIP"));
  results.querySelector(".chips")?.closest(".field")?.remove();
}

/* Stage */
let view: HTMLElement, tray: HTMLElement, before: HTMLCanvasElement, after: HTMLCanvasElement, frame: HTMLElement;
function picker(label: string) {
  const i = el("input", { type: "file", accept: tool.accepts, multiple: !!tool.multi, "aria-label": label });
  i.onchange = () => { addFiles([...i.files]); i.value = ""; };
  return i;
}
const emptyStage = [...stage.childNodes];
stage.querySelector<HTMLInputElement>(".empty input").onchange = (e) => { const i = e.target as HTMLInputElement; addFiles([...i.files]); i.value = ""; };

function drawTray() {
  tray.replaceChildren(...files.map((f, i) => {
    const x = el("button", { className: "x", type: "button", "aria-label": `Remove ${f.name}`, textContent: "×" });
    x.onclick = () => {
      if (busy) return setNotice(WAIT);
      files.splice(i, 1); current = Math.min(current, files.length - 1); afterFilesChanged();
      tray?.querySelectorAll<HTMLElement>("button.x")[Math.min(i, files.length - 1)]?.focus();
    };
    const b = el("button", { className: "file", type: "button", title: `${f.name}, ${fmtSize(f.size)}`, "aria-current": String(i === current) }, el("span", { className: "fname", textContent: f.name }));
    b.onclick = () => { current = i; drawTray(); showCurrent(); tray.querySelectorAll<HTMLElement>("button.file")[i]?.focus(); };
    return el("span", { className: "item" }, b, x);
  }));
  if (tool.multi) tray.append(el("label", { className: "add" }, "Add more", picker("Add more files")));
}

const WAIT = "Wait for this run to finish, or cancel it, before changing files.";
const listNames = (l: File[]) => l.slice(0, 4).map((f) => f.name).join(", ") + (l.length > 4 ? ` and ${l.length - 4} more` : "");
async function addFiles(list: File[]) {
  if (busy) return setNotice(WAIT);
  const accepted = list.filter(okFile);
  if (list.length && !accepted.length) return showError(tool.kind === "pdf" && !tool.accepts.includes("image") ? "This tool takes PDF files." : "That file type is not supported here.");
  clearMsg();
  const used = tool.multi ? accepted : accepted.slice(0, 1), ignored = list.filter((f) => !used.includes(f));
  setNotice(ignored.length ? `Not added: ${listNames(ignored)}. ${tool.multi ? "This tool cannot use them." : "This tool works on one file at a time."}` : "");
  const next = await prepared(used.map((f) => ({ id: `f${++uid}`, name: f.name || "pasted-image.png", type: f.type, size: f.size, blob: f as Blob })));
  if (!next.length) { if (files.length) { drawTray(); showCurrent(); } else resetTool(); return; }
  files = tool.multi ? [...files, ...next] : next;
  current = tool.multi ? files.length - next.length : 0;
  afterFilesChanged();
}
// These tools choose pages by what the reader shows, so the file is rewritten first and every parser sees the same pages.
const NORMALISE = new Set(["redact-pdf", "sign-pdf", "delete-pages", "extract-pages", "split-pdf", "organize-pdf"]);
async function prepared(list: In[]) {
  if (!NORMALISE.has(engineId)) return list;
  busy = true; go.disabled = true; prog.classList.add("on"); setProgress(0.1, "Checking the file…");
  // The engine can take a moment to load, so the file appears straight away.
  if (!view) {
    stage.replaceChildren(view = el("div", { className: "view" }, el("p", { textContent: "Checking the file…" })), tray = el("div", { className: "tray intake" }));
    tray.append(...list.map((f) => el("span", { className: "file" }, el("span", { className: "fname", textContent: f.name }))));
  }
  const ok: In[] = [], notes: string[] = [];
  for (const f of list) {
    if (!isPdfFile(f)) { ok.push(f); continue; }
    try {
      const [o] = await runTool("prepare-pdf", [f], {});
      const t = o.text ? JSON.parse(o.text) : {};
      if (t.signed && engineId === "sign-pdf") notes.push(`${f.name} has a digital signature. Adding a visual signature invalidates it.`);
      if (t.repaired) notes.push(`${f.name} was damaged and has been repaired. Check every page.`);
      // A new id, so nothing rendered from the original bytes can be reused for the rewritten file.
      ok.push(o.bytes ? { ...f, id: `f${++uid}`, size: o.bytes.length, restricted: !!t.restricted, blob: new Blob([o.bytes as BlobPart], { type: "application/pdf" }) } : f);
    } catch (e) { notes.push((e as Error).message); }
  }
  busy = false; prog.classList.remove("on"); go.disabled = !ready();
  if (notes.length) setNotice([notice.textContent, ...notes].filter(Boolean).join(" "));
  return ok;
}
function okFile(f: File) {
  const a = tool.accepts.split(",").map((x) => x.trim().toLowerCase()), n = f.name.toLowerCase(), t = f.type.toLowerCase();
  return a.some((x) => (x.startsWith(".") ? n.endsWith(x) : x.endsWith("/*") ? t.startsWith(x.slice(0, -1)) : t === x));
}
function afterFilesChanged() {
  if (!files.length && !tool.noInput) return resetTool();
  leaveResult?.(); boxes.length = 0; syncMarks();
  if (!view) {
    stage.replaceChildren(view = el("div", { className: "view" }), tray = el("div", { className: "tray" }));
  }
  tray.classList.remove("intake");
  drawTray();
  go.disabled = !ready();
  showCurrent();
}
const ready = () => {
  if (tool.noInput) return true;
  if (files.length < (tool.min ?? 1)) return false;
  return tool.editor !== "sign" || boxes.length > 0;
};

function resetOutput() { leaveResult?.(); outs.forEach((o) => o.url && URL.revokeObjectURL(o.url)); outs = []; results.replaceChildren(); }
function resetTool() {
  resetOutput(); boxes.length = 0; signature = null; syncMarks();
  stage.replaceChildren(...emptyStage); view = tray = frame = before = after = null;
  pagesApi = null; pagesFiles = 0; pagesIds = [];
  extra.replaceChildren(); clearMsg(); setNotice(""); go.disabled = true;
}
function editorFailed(e: any) {
  const m = e?.name === "PasswordException" ? "This file is password protected. Unlock it first with Unlock PDF." : "This PDF is damaged or incomplete, so it cannot be edited here. Try Repair PDF.";
  view.className = "view"; view.replaceChildren(el("p", { style: "text-align:center;max-width:36ch", textContent: m }));
  pagesApi = null; extra.replaceChildren(); go.disabled = true; say(m);
}

async function showCurrent() {
  const f = files[current];
  if (!f) return;
  view.style.padding = ""; view.style.placeItems = "";
  const need = (tool.min ?? 1) - files.length;
  if (need > 0) { msg.className = "ok"; msg.textContent = `Add ${need} more file${need === 1 ? "" : "s"} to continue.`; } else if (msg.className === "ok") clearMsg();
  leaveResult?.();
  if (tool.editor === "pages") {
    // Until every page is listed, a run would silently leave out the pages still loading.
    go.disabled = true;
    try {
      // Adding a file keeps the arrangement so far. Removing one changes every index, so that starts over.
      if (pagesApi && files.length > pagesFiles && pagesKept()) await pagesApi.append(files);
      else if (!pagesApi || files.length !== pagesFiles || !pagesKept()) pagesApi = await pagesEditor(view, files, (o) => { params.order = o; markStale(); });
      pagesFiles = files.length; pagesIds = files.map((x) => x.id); go.disabled = !ready();
    } catch (e) { editorFailed(e); }
    return;
  }
  if (tool.editor === "form") { go.disabled = true; /* Until the fields load, a run would save none of them. */ await showPdf(f); const host = el("div", { style: "display:grid;gap:12px" }); extra.replaceChildren(host); params.values = {}; try { const n = await formFields(host, f, params.values); go.disabled = !n; } catch (e) { showError((e as Error).message); } return; }
  if (tool.editor === "regions" && tool.kind === "pdf") {
    const addMark = { label: (i: number) => `Add box on page ${i + 1}`, run: (i: number, s: HTMLElement) => { const b: Box = { page: i, x: 0.3, y: 0.42, w: 0.4, h: 0.08 }; boxes.push(b); const n = addBox(s, b, boxes, syncMarks); syncMarks(); n.focus(); } };
    try { await pageMarkup(view, f, boxes, syncMarks, undefined, addMark); hint("Drag on a page, or use Add box, to mark what to remove."); } catch (e) { editorFailed(e); }
    return;
  }
  if (tool.editor === "sign") { try { await signSetup(f); } catch (e) { editorFailed(e); } return; }
  if (tool.kind === "pdf" && isPdfFile(f)) { await showPdf(f); return; }
  await showImage(f);
}
const isPdfFile = (f: In) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const hint = (m: string) => { if (!msg.textContent) { msg.className = "ok"; msg.textContent = m; } };

async function showPdf(f: In | Out, blob?: Blob) {
  view.className = "view scroll"; view.replaceChildren();
  const grid = el("div", { className: "pages" }); view.append(grid);
  try {
    const doc = await openPdf((f as In).id ?? `out-${Date.now()}`, blob ?? (f as In).blob), n = Math.min(doc.numPages, 60);
    const io = new IntersectionObserver((es) => es.forEach(async (e) => { if (!e.isIntersecting) return; io.unobserve(e.target); const t = e.target as HTMLElement, pg = await doc.getPage(+t.dataset.i + 1), k = (124 * Math.min(devicePixelRatio, 2)) / pg.getViewport({ scale: 1 }).width, c = await renderPage(doc, +t.dataset.i, k); c.style.width = "124px"; t.style.aspectRatio = ""; t.prepend(c); }), { root: view, rootMargin: "300px" });
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
    for (let i = 0; i < n; i++) { const s = el("div", { className: "sheet", "data-i": i }); s.style.width = "124px"; s.style.aspectRatio = `${vp.width} / ${vp.height}`; grid.append(el("div", { className: "pg" }, s, el("span", { textContent: String(i + 1) }))); io.observe(s); }
    if (doc.numPages > n) grid.append(el("p", { textContent: `and ${doc.numPages - n} more pages` }));
  } catch (e: any) {
    const locked = e?.name === "PasswordException";
    view.className = "view";
    view.replaceChildren(el("p", { style: "text-align:center;max-width:36ch", textContent: locked ? (engineId === "unlock-pdf" ? "This file is password protected. Enter the password to unlock it." : "This file is password protected. Unlock it first with Unlock PDF.") : "This PDF cannot be previewed, but the tool may still be able to process it." }));
  }
}

const paint = (c: HTMLCanvasElement, b: ImageBitmap) => { c.width = b.width; c.height = b.height; c.getContext("2d").drawImage(b, 0, 0); };
async function showImage(f: In) {
  view.className = "view"; view.replaceChildren(el("p", { textContent: "Opening…" }));
  let t: Out;
  try { [t] = await runTool("thumb", [f], {}, {}); }
  catch (e) { say((e as Error).message); view.replaceChildren(el("p", { style: "text-align:center;max-width:36ch", textContent: (e as Error).message })); if (!tool.noInput && files.length < 2) go.disabled = true; return; }
  if (files[current] !== f) return;
  go.disabled = !ready();
  before = el("canvas"); paint(before, t.bitmap);
  frame = el("div", { className: "frame" }, before);
  view.replaceChildren(frame);
  after = null;
  if (tool.editor === "crop") {
    const label = el("span", { className: "tag l" }); frame.append(label);
    cropApi = cropEditor(frame, () => (params.aspect && params.aspect !== "free" ? +params.aspect : null), { w: t.width, h: t.height }, (r: Rect) => { params.crop = r; label.textContent = `${Math.round(r.w * t.width)} × ${Math.round(r.h * t.height)}${t.width >= 1400 || t.height >= 1400 ? " (preview scale)" : ""}`; });
  } else if (tool.editor === "regions") {
    frame.style.cursor = "crosshair"; frame.style.touchAction = "none"; regionSurface(frame, 0, boxes, syncMarks); boxes.forEach((b) => addBox(frame, b, boxes, syncMarks)); hint("Drag on the image to mark what to hide.");
  } else if (tool.live) schedulePreview(true);
}

function wipe(result: ImageBitmap | Blob, width?: number, height?: number) {
  const place = (b: ImageBitmap) => {
    if (!frame) return;
    if (!after) {
      after = el("canvas", { className: "after" });
      const h = el("button", { className: "wipe", type: "button", role: "slider", "aria-label": "Compare before and after. Use left and right arrow keys.", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 50, "aria-valuetext": "50% before" });
      frame.append(after, el("span", { className: "tag l", textContent: "Before" }), el("span", { className: "tag r", textContent: "After" }), h);
      const set = (v: number) => { const at = Math.max(0, Math.min(100, v)); frame.style.setProperty("--cut", `${at}%`); h.setAttribute("aria-valuenow", String(Math.round(at))); h.setAttribute("aria-valuetext", `${Math.round(at)}% before`); };
      let cut = 50; set(cut);
      h.onpointerdown = (e) => { h.setPointerCapture(e.pointerId); h.onpointermove = (m) => { const r = frame.getBoundingClientRect(); cut = ((m.clientX - r.left) / r.width) * 100; set(cut); }; };
      h.onpointerup = () => (h.onpointermove = null);
      h.onkeydown = (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); cut = Math.max(0, Math.min(100, cut + (e.key === "ArrowLeft" ? -2 : 2))); set(cut); } };
    }
    paint(after, b);
    // A crop or resize changes the shape, so show the result on its own frame ratio.
    const sameShape = Math.abs(b.width / b.height - before.width / before.height) < 0.01;
    frame.querySelectorAll<HTMLElement>(".wipe,.tag").forEach((n) => (n.style.display = sameShape ? "" : "none"));
    before.style.visibility = sameShape ? "" : "hidden";
    if (sameShape) { after.style.position = ""; after.style.clipPath = ""; after.className = "after"; }
    else { after.className = ""; after.style.position = "absolute"; after.style.inset = "0"; after.style.margin = "auto"; after.style.width = "100%"; after.style.height = "100%"; after.style.objectFit = "contain"; after.style.clipPath = "none"; }
  };
  if (result instanceof Blob) createImageBitmap(result).then(place).catch(() => { /* Formats this browser cannot display still download fine. */ });
  else place(result);
}

/* Live preview */
function schedulePreview(now = false) {
  if (!tool.live || !files.length || files.length < (tool.min ?? 1)) return;
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(previewNow, now ? 0 : 90);
}
async function previewNow() {
  if (busy) return;
  if (previewBusy) { previewAgain = true; return; }
  previewBusy = true;
  try {
    const f = files[current], input = ["compare-images", "collage"].includes(engineId) ? files : [f];
    const [o] = await runTool(engineId, input, { ...params }, { preview: true });
    if (files[current] === f) showPreview(o);
  } catch (e) { if ((e as Error).name !== "AbortError") showError((e as Error).message); }
  previewBusy = false;
  if (previewAgain) { previewAgain = false; previewNow(); }
}
let textView: HTMLElement;
function showPreview(o: Out) {
  if (msg.className === "alert") clearMsg();
  if (o.swatches) return showSwatches(o);
  if (o.bitmap) return wipe(o.bitmap);
  if (o.bytes && o.type.startsWith("image/")) {
    const blob = new Blob([o.bytes as BlobPart], { type: o.type });
    if (o.type !== "image/heic" && o.type !== "image/jxl") wipe(blob);
    const orig = files[current]?.size;
    msg.className = "ok"; msg.textContent = `About ${fmtSize(o.bytes.length)}${orig ? `, ${Math.round((1 - o.bytes.length / orig) * 100)}% ${o.bytes.length < orig ? "smaller" : "change"}` : ""}${o.note ? `. ${o.note}` : ""}`;
    if (o.bytes.length >= orig) msg.textContent = `About ${fmtSize(o.bytes.length)}, larger than the original${o.note ? `. ${o.note}` : ""}`;
  }
}
function showSwatches(o: Out) {
  const row = el("div", { className: "swatches" }, ...o.swatches.map((hex) => {
    const n = parseInt(hex.slice(1), 16), l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    const b = el("button", { type: "button", textContent: hex, title: `Copy ${hex}` }); b.style.background = hex; b.style.color = l > 150 ? "#14233d" : "#fff";
    b.onclick = async () => { await navigator.clipboard?.writeText(hex); b.textContent = "Copied"; setTimeout(() => (b.textContent = hex), 900); };
    return b;
  }));
  view.className = "view"; view.replaceChildren(row); frame = null;
}

/* Sign */
async function signSetup(f: In) {
  extra.replaceChildren();
  extra.append(el("p", { className: "lab", textContent: "This places an image of your signature. It is not a certified digital signature." }));
  signaturePanel(extra, (s) => {
    // An earlier version of the signature is released unless a placed mark still shows it.
    if (signature && signature.url !== s?.url && !boxes.some((b) => b.url === signature.url)) URL.revokeObjectURL(signature.url);
    signature = s; go.disabled = busy || !ready();
    if (s) { clearMsg(); hint("Click or tap a page, or use Place signature, to put it on the page."); if (matchMedia("(max-width: 940px)").matches) view.scrollIntoView({ block: "start" }); }
  });
  go.disabled = !ready();
  const place = (page: number, surface: HTMLElement, cx = 0.5, cy = 0.5) => {
    if (!signature) { clearMsg(); msg.className = "ok"; msg.textContent = "Draw or type your signature first."; say(msg.textContent); return; }
    const r = surface.getBoundingClientRect(), w = 0.3, h = (w * r.width) / signature.ratio / r.height;
    const b: Box = { page, w, h, x: Math.max(0, Math.min(1 - w, cx - w / 2)), y: Math.max(0, Math.min(1 - h, cy - h / 2)), png: signature.png, url: signature.url };
    boxes.push(b); const n = addBox(surface, b, boxes, syncMarks); syncMarks(); n.focus();
  };
  await pageMarkup(view, f, boxes, syncMarks, (page, surface) => {
    surface.addEventListener("click", (e) => {
      if (e.target !== surface && (e.target as HTMLElement).tagName !== "CANVAS") return;
      const r = surface.getBoundingClientRect();
      place(page, surface, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
  }, { label: (i) => `Place signature on page ${i + 1}`, run: (i, s) => place(i, s) });
}

/* Run */
const NEXT: Record<string, string[]> = { "application/pdf": ["compress-pdf", "protect-pdf", "sign-pdf", "page-numbers", "organize-pdf"], image: ["compress-image", "resize-image", "remove-metadata", "images-to-pdf"] };
async function run() {
  if (busy) return;
  const asked = tool.model && !consented;
  if (asked) { consented = true; consent.hidden = true; go.textContent = actionLabel; }
  resetOutput(); busy = true; changedDuringRun = false; go.disabled = true; clearMsg(); setNotice(""); prog.classList.add("on"); setProgress(0.02, "Working…"); say("Working");
  const started = performance.now();
  try {
    const input = engineId === "markdown-to-pdf" ? files.slice(0, 1) : files;
    const res = await runTool(engineId, input, { ...params }, { onProgress: setProgress });
    setProgress(1, "");
    outs = res.map((o) => ({ ...o, url: o.bytes ? URL.createObjectURL(new Blob([o.bytes as BlobPart], { type: o.type })) : o.text != null ? URL.createObjectURL(new Blob([o.text], { type: `${o.type};charset=utf-8` })) : undefined }));
    // Remembered only once the model has really loaded, so a failed download asks again.
    if (asked) try { localStorage.setItem(`lathe:model:${tool.model.name}`, "1"); } catch { /* Ask again next time. */ }
    drawResults(performance.now() - started);
    const failed = res.flatMap((o) => o.failed ?? []);
    if (failed.length) setNotice(`${outs.length} of ${outs.length + failed.length} finished. Not processed: ${failed.join("; ")}`);
    say(`Done. ${outs.length} result${outs.length === 1 ? "" : "s"} ready.`);
    results.querySelector<HTMLElement>("a[download]")?.focus({ preventScroll: true });
  } catch (e) {
    if (asked) { consented = false; consent.hidden = false; go.textContent = "Download model and run"; }
    if ((e as Error).name === "AbortError") { setNotice("Cancelled. Your files are unchanged."); say("Cancelled"); }
    else showError((e as Error).message);
  }
  busy = false; go.disabled = !ready(); prog.classList.remove("on");
  if (changedDuringRun) { changedDuringRun = false; markStale(); schedulePreview(); }
}
go.onclick = run;

function drawResults(ms: number) {
  const inputTotal = files.reduce((a, f) => a + f.size, 0), outTotal = outs.reduce((a, o) => a + (o.bytes?.length ?? 0), 0);
  const head = el("h2", { textContent: outs.length === 1 ? `Ready in ${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`}` : `${outs.length} files ready` });
  results.replaceChildren(head);
  outs.forEach((o, i) => {
    const size = o.bytes?.length ?? 0, src = files[i]?.size, one = outs.length === files.length || files.length === 1;
    const small = el("small");
    if (size) small.append(fmtSize(size));
    if (o.width) small.append(`, ${o.width} × ${o.height}`);
    if (size && one && src && size < src) small.append(", ", el("span", { className: "delta", textContent: `${Math.round((1 - size / src) * 100)}% smaller` }));
    if (o.note) { if (small.childNodes.length) small.append(". "); small.append(o.note); }
    const row = el("div", { className: "res" }, el("b", { textContent: o.name }), small);
    if (o.url) row.append(el("a", { className: "btn small", href: o.url, download: o.name, textContent: "Download" }));
    results.append(row);
  });
  if (outs.some((o) => o.reused)) {
    const secure = el("button", { className: "btn alt", type: "button", textContent: "Remove securely" });
    secure.onclick = () => { params.secure = true; run(); params.secure = false; };
    results.append(secure);
  }
  if (outs.length > 1) { const all = el("button", { className: "btn zip", type: "button", textContent: "Download all as ZIP" }); all.onclick = async () => { const { zipOut } = await import("../engine/core"); const z = zipOut("lathe.zip", outs.filter((o) => o.bytes || o.text != null).map((o) => ({ name: o.name, bytes: o.bytes ?? new TextEncoder().encode(o.text) }))); const a = el("a", { href: URL.createObjectURL(new Blob([z.bytes as BlobPart], { type: "application/zip" })), download: z.name }); a.click(); }; results.append(all); }
  const first = outs[0];
  if (first?.text != null && !first.swatches) {
    const area = el("textarea", { className: "textout", readOnly: true, value: first.text, "aria-label": "Result text" });
    view.className = "view"; view.style.padding = "0"; view.style.placeItems = "stretch"; view.replaceChildren(area); frame = null; textView = area;
    const copy = el("button", { className: "btn alt", type: "button", textContent: "Copy text" }); copy.onclick = async () => { await navigator.clipboard.writeText(first.text); copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy text"), 1000); }; results.append(copy);
  } else if (first?.swatches) { showSwatches(first); }
  else if (first?.type === "application/pdf" && outs.length === 1) {
    if (tool.kind === "pdf" && ["regions", "sign", "pages"].includes(tool.editor)) results.append(checkResult(first));
    else showPdf({ ...first, id: `out-${uid++}` } as any, new Blob([first.bytes as BlobPart], { type: "application/pdf" }));
  }
  else if (first?.type.startsWith("image/") && first.bytes && first.type !== "image/heic" && first.type !== "image/jxl" && frame && tool.editor !== "crop") wipe(new Blob([first.bytes as BlobPart], { type: first.type }));

  // Carry the result straight into another tool.
  const handable = outs.filter((o) => o.bytes && (o.type === "application/pdf" || o.type.startsWith("image/")));
  if (handable.length) {
    const kind = handable[0].type === "application/pdf" ? "application/pdf" : "image", ids = NEXT[kind].filter((x) => x !== tool.id && x !== engineId).slice(0, 3);
    const chips = ids.map((id) => { const b = el("button", { className: "chip", type: "button", textContent: id.replace(/-/g, " ").replace(/\bpdf\b/, "PDF").replace(/^./, (c) => c.toUpperCase()) }); b.onclick = async () => { await stash(handable.map((o) => new File([o.bytes as BlobPart], o.name, { type: o.type }))); location.href = `/${id}?with=files`; }; return b; });
    results.append(el("div", { className: "field" }, el("span", { className: "lab", textContent: "Keep going with this result" }), el("div", { className: "chips" }, ...chips)));
  }
}

/** Shows the output at reading size. The editor stays intact underneath, so marks can still be corrected. */
function checkResult(o: Out) {
  const b = el("button", { className: "btn alt", type: "button", textContent: "Check the result" });
  const blob = new Blob([o.bytes as BlobPart], { type: o.type }), id = `out-${uid++}`;
  b.onclick = async () => {
    if (leaveResult) return leaveResult();
    const kept = [...view.childNodes], cls = view.className;
    leaveResult = () => { leaveResult = null; view.className = cls; view.replaceChildren(...kept); b.textContent = "Check the result"; };
    b.textContent = "Back to editing";
    await pageMarkup(view, { id, name: o.name, type: o.type, size: blob.size, blob }, [], () => {}, () => {});
  };
  return b;
}

/* Input */
addEventListener("beforeunload", (e) => { if (busy || (boxes.length && !outs.length)) e.preventDefault(); });
addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) { e.preventDefault(); stage.classList.add("over"); } });
addEventListener("dragleave", (e) => { if (!e.relatedTarget) stage.classList.remove("over"); });
addEventListener("drop", (e) => { if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return; e.preventDefault(); stage.classList.remove("over"); addFiles([...e.dataTransfer.files]); });
addEventListener("paste", (e) => { const t = e.target as HTMLElement; if (e.clipboardData?.files.length && !/INPUT|TEXTAREA/.test(t.tagName)) addFiles([...e.clipboardData.files]); });
addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !go.disabled) run(); });
if (new URLSearchParams(location.search).has("with")) {
  history.replaceState(null, "", location.pathname);
  unstash().then((f) => f.length && addFiles(f)).catch(() => { /* Nothing was handed over. */ });
}
// The test suite sets this flag before the page loads. Normal visits never expose settings or output.
if ((window as any).__latheTest) (window as any).__lathe = { addFiles, get files() { return files; }, get outs() { return outs; }, params, get busy() { return busy; } };

