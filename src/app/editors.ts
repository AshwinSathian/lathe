// Direct-manipulation editors: crop, regions, signature placement, page organiser, form fields.
import { openPdf, pdfFields, renderPage } from "./client";
import type { In } from "../engine/core";

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: (Node | string)[]) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k.startsWith("data-") || k.startsWith("aria-")) n.setAttribute(k, String(v)); else (n as any)[k] = v; }
  n.append(...kids);
  return n;
};
const clamp = (v: number, a: number, z: number) => Math.min(z, Math.max(a, v));
export type Rect = { x: number; y: number; w: number; h: number };

/** Drag tracking that works for mouse, touch and pen. */
function drag(handle: HTMLElement, move: (dx: number, dy: number, e: PointerEvent) => void, start?: (e: PointerEvent) => void, end?: () => void) {
  handle.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button") && (e.target as HTMLElement) !== handle) return;
    e.stopPropagation(); e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY; start?.(e);
    const m = (v: PointerEvent) => move(v.clientX - x0, v.clientY - y0, v);
    const up = () => { handle.removeEventListener("pointermove", m); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); end?.(); };
    handle.addEventListener("pointermove", m); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  });
}

export function cropEditor(frame: HTMLElement, getAspect: () => number | null, pixel: { w: number; h: number }, onChange: (r: Rect) => void) {
  const box = el("div", { className: "cropbox", tabIndex: 0, role: "group", "aria-label": "Crop area. Use arrow keys to move, Shift and arrow keys to resize." });
  for (const h of ["nw", "ne", "sw", "se"]) box.append(el("i", { "data-h": h }));
  frame.append(box);
  let r: Rect = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };
  const paint = () => { box.style.left = `${r.x * 100}%`; box.style.top = `${r.y * 100}%`; box.style.width = `${r.w * 100}%`; box.style.height = `${r.h * 100}%`; onChange(r); };
  const applyAspect = () => {
    const a = getAspect();
    if (a) { const ar = a * (pixel.h / pixel.w); let w = r.w, h = w / ar; if (h > 1) { h = 1; w = h * ar; } if (w > 1) { w = 1; h = w / ar; } r = { x: clamp(r.x + (r.w - w) / 2, 0, 1 - w), y: clamp(r.y + (r.h - h) / 2, 0, 1 - h), w, h }; }
    paint();
  };
  let s: Rect;
  drag(box, (dx, dy) => { const b = frame.getBoundingClientRect(); r = { ...r, x: clamp(s.x + dx / b.width, 0, 1 - r.w), y: clamp(s.y + dy / b.height, 0, 1 - r.h) }; paint(); }, () => (s = { ...r }));
  box.querySelectorAll<HTMLElement>("i").forEach((hd) => drag(hd, (dx, dy) => {
    const b = frame.getBoundingClientRect(), k = hd.dataset.h, a = getAspect(), min = 0.02;
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (k.includes("w")) x0 = clamp(s.x + dx / b.width, 0, x1 - min); else x1 = clamp(x1 + dx / b.width, x0 + min, 1);
    if (k.includes("n")) y0 = clamp(s.y + dy / b.height, 0, y1 - min); else y1 = clamp(y1 + dy / b.height, y0 + min, 1);
    if (a) {
      const ar = a * (pixel.h / pixel.w); let w = x1 - x0, h = w / ar;
      const maxH = k.includes("n") ? s.y + s.h : 1 - s.y; if (h > maxH) { h = maxH; w = h * ar; }
      const maxW = k.includes("w") ? s.x + s.w : 1 - s.x; if (w > maxW) { w = maxW; h = w / ar; }
      if (k.includes("w")) x0 = s.x + s.w - w; else x1 = x0 + w;
      if (k.includes("n")) y0 = s.y + s.h - h; else y1 = y0 + h;
    }
    r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; paint();
  }, () => (s = { ...r })));
  box.addEventListener("keydown", (e) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (!d) return; e.preventDefault();
    const sx = (e.altKey ? 10 : 1) / pixel.w * Math.max(1, Math.round(pixel.w / 400)), sy = (e.altKey ? 10 : 1) / pixel.h * Math.max(1, Math.round(pixel.h / 400));
    if (e.shiftKey && !getAspect()) r = { ...r, w: clamp(r.w + d[0] * sx, 0.01, 1 - r.x), h: clamp(r.h + d[1] * sy, 0.01, 1 - r.y) };
    else r = { ...r, x: clamp(r.x + d[0] * sx, 0, 1 - r.w), y: clamp(r.y + d[1] * sy, 0, 1 - r.h) };
    paint();
  });
  applyAspect();
  return { applyAspect };
}

type Box = Rect & { page: number; png?: Uint8Array; url?: string };
function addBox(surface: HTMLElement, b: Box, all: Box[], changed: () => void) {
  const n = el("div", { className: b.url ? "box sig" : "box", tabIndex: 0, role: "group", "aria-label": `Marked area on page ${b.page + 1}. Delete key removes it.` });
  if (b.url) n.append(el("img", { src: b.url, alt: "" }));
  const remove = () => { all.splice(all.indexOf(b), 1); n.remove(); changed(); };
  const del = el("button", { className: "del", type: "button", "aria-label": "Remove", textContent: "×" }); del.onclick = (e) => { e.stopPropagation(); remove(); };
  const grip = el("div", { className: "grip" });
  n.append(del, grip); surface.append(n);
  const paint = () => { n.style.left = `${b.x * 100}%`; n.style.top = `${b.y * 100}%`; n.style.width = `${b.w * 100}%`; n.style.height = `${b.h * 100}%`; };
  let s: Rect;
  drag(n, (dx, dy) => { const r = surface.getBoundingClientRect(); b.x = clamp(s.x + dx / r.width, 0, 1 - b.w); b.y = clamp(s.y + dy / r.height, 0, 1 - b.h); paint(); }, () => (s = { ...b }), changed);
  drag(grip, (dx, dy) => { const r = surface.getBoundingClientRect(); b.w = clamp(s.w + dx / r.width, 0.01, 1 - b.x); b.h = b.url ? (b.w * s.h) / s.w : clamp(s.h + dy / r.height, 0.005, 1 - b.y); if (b.y + b.h > 1) { b.h = 1 - b.y; if (b.url) b.w = (b.h * s.w) / s.h; } paint(); }, () => (s = { ...b }), changed);
  n.addEventListener("keydown", (e) => { if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); } });
  paint();
  return n;
}

/** Draw boxes on a surface. Used for redaction and for hiding parts of an image. */
export function regionSurface(surface: HTMLElement, page: number, all: Box[], changed: () => void) {
  surface.addEventListener("pointerdown", (e) => {
    if (e.target !== surface && (e.target as HTMLElement).tagName !== "CANVAS") return;
    e.preventDefault(); surface.setPointerCapture(e.pointerId);
    const r = surface.getBoundingClientRect(), x0 = clamp((e.clientX - r.left) / r.width, 0, 1), y0 = clamp((e.clientY - r.top) / r.height, 0, 1), b: Box = { page, x: x0, y: y0, w: 0.002, h: 0.002 };
    all.push(b);
    const n = addBox(surface, b, all, changed);
    const m = (v: PointerEvent) => { const x = clamp((v.clientX - r.left) / r.width, 0, 1), y = clamp((v.clientY - r.top) / r.height, 0, 1); b.x = Math.min(x, x0); b.y = Math.min(y, y0); b.w = Math.abs(x - x0); b.h = Math.abs(y - y0); n.style.left = `${b.x * 100}%`; n.style.top = `${b.y * 100}%`; n.style.width = `${b.w * 100}%`; n.style.height = `${b.h * 100}%`; };
    const up = () => { surface.removeEventListener("pointermove", m); surface.removeEventListener("pointerup", up); if (b.w < 0.006 || b.h < 0.004) { all.splice(all.indexOf(b), 1); n.remove(); } changed(); };
    surface.addEventListener("pointermove", m); surface.addEventListener("pointerup", up);
  });
}

async function lazyPages(host: HTMLElement, f: In, width: number, build: (i: number, sheet: HTMLElement, c: HTMLCanvasElement | null) => void) {
  const doc = await openPdf(f.id, f.blob), io = new IntersectionObserver((es) => es.forEach(async (e) => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    const el = e.target as HTMLElement, i = +el.dataset.i, pg = await doc.getPage(i + 1), base = pg.getViewport({ scale: 1 }), k = (width * Math.min(devicePixelRatio, 2)) / base.width, c = await renderPage(doc, i, k);
    c.style.width = `${width}px`; c.style.maxWidth = "100%"; c.style.height = "auto"; el.style.minHeight = ""; el.style.aspectRatio = ""; el.prepend(c);
  }), { root: host.closest(".view"), rootMargin: "400px" });
  const first = await doc.getPage(1), vp = first.getViewport({ scale: 1 });
  for (let i = 0; i < doc.numPages; i++) {
    const sheet = el("div", { className: "sheet", "data-i": i }); sheet.style.width = `${width}px`; sheet.style.maxWidth = "100%"; sheet.style.aspectRatio = `${vp.width} / ${vp.height}`;
    build(i, sheet, null); io.observe(sheet);
  }
  return doc;
}

export async function pagesEditor(view: HTMLElement, files: In[], onChange: (order: { f: number; page: number; rot: number }[]) => void) {
  view.className = "view scroll"; view.replaceChildren();
  const grid = el("div", { className: "pages" }); view.append(grid);
  const order: { f: number; page: number; rot: number; node: HTMLElement }[] = [];
  const sync = () => {
    order.forEach((o, i) => { o.node.querySelector<HTMLElement>(".num").textContent = `${i + 1}`; const c = o.node.querySelector<HTMLElement>("canvas"); if (c) { c.style.transform = o.rot ? `rotate(${o.rot}deg) scale(${o.rot % 180 ? 0.72 : 1})` : ""; } });
    onChange(order.map(({ f, page, rot }) => ({ f, page, rot })));
  };
  const place = (o: (typeof order)[0], to: number) => { order.splice(order.indexOf(o), 1); order.splice(to, 0, o); grid.insertBefore(o.node, order[to + 1]?.node ?? null); sync(); o.node.scrollIntoView({ block: "nearest" }); };
  let dragged: (typeof order)[0];
  let built = 0;
  const append = async (next = files) => { files = next; for (let f = built; f < files.length; f = ++built) {
    await lazyPages(view, files[f], 124, (page, sheet) => {
      const node = el("div", { className: "pg", draggable: true }), o = { f, page, rot: 0, node };
      const btn = (label: string, glyph: string, fn: () => void) => { const b = el("button", { type: "button", title: label, "aria-label": `${label}, page ${page + 1}${files.length > 1 ? ` of ${files[f].name}` : ""}`, textContent: glyph }); b.onclick = fn; return b; };
      node.append(sheet, el("span", { className: "num" }), el("div", { className: "tools" }, btn("Move earlier", "‹", () => { const i = order.indexOf(o); if (i > 0) place(o, i - 1); }), btn("Rotate", "↻", () => { o.rot = (o.rot + 90) % 360; sync(); }), btn("Delete", "×", () => { order.splice(order.indexOf(o), 1); node.remove(); sync(); }), btn("Move later", "›", () => { const i = order.indexOf(o); if (i < order.length - 1) place(o, i + 1); })));
      node.addEventListener("dragstart", (e) => { dragged = o; node.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(page)); e.stopPropagation(); });
      node.addEventListener("dragend", () => { node.classList.remove("drag"); grid.querySelectorAll(".target").forEach((x) => x.classList.remove("target")); dragged = null; });
      node.addEventListener("dragover", (e) => { if (!dragged) return; e.preventDefault(); e.stopPropagation(); node.classList.add("target"); });
      node.addEventListener("dragleave", () => node.classList.remove("target"));
      node.addEventListener("drop", (e) => { if (!dragged || dragged === o) return; e.preventDefault(); e.stopPropagation(); node.classList.remove("target"); place(dragged, order.indexOf(o)); });
      order.push(o); grid.append(node);
    });
  } sync(); };
  await append();
  return { append };
}

export async function pageMarkup(view: HTMLElement, f: In, boxes: Box[], changed: () => void, onSurface?: (page: number, s: HTMLElement) => void) {
  view.className = "view scroll"; view.replaceChildren();
  const list = el("div", { className: "docpages" }); view.append(list);
  const width = Math.min(760, view.clientWidth - 40);
  await lazyPages(view, f, width, (i, sheet) => {
    sheet.className = "docpage";
    list.append(sheet);
    if (onSurface) onSurface(i, sheet); else regionSurface(sheet, i, boxes, changed);
    // Marks outlive a redraw of the page, so every mark that will be applied stays on screen.
    boxes.filter((b) => b.page === i).forEach((b) => addBox(sheet, b, boxes, changed));
  });
}
export { addBox };
export type { Box };

export function signaturePanel(host: HTMLElement, onReady: (s: { png: Uint8Array; url: string; ratio: number } | null) => void) {
  const body = el("div", { className: "field" }), seg = el("div", { className: "seg", role: "group", "aria-label": "Signature type" });
  let mode = "draw", pad: HTMLCanvasElement, typed: HTMLInputElement;
  const finish = async (c: HTMLCanvasElement) => {
    const g = c.getContext("2d", { willReadFrequently: true }), d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) return onReady(null);
    const w = x1 - x0 + 5, h = y1 - y0 + 5, t = el("canvas", { width: w, height: h }); t.getContext("2d").drawImage(c, x0 - 2, y0 - 2, w, h, 0, 0, w, h);
    const blob: Blob = await new Promise((r) => t.toBlob(r, "image/png"));
    onReady({ png: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), ratio: w / h });
  };
  const show = () => {
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === mode)));
    body.replaceChildren(); onReady(null);
    if (mode === "draw") {
      pad = el("canvas", { className: "sigpad", "aria-label": "Draw your signature" }); body.append(pad);
      const clear = el("button", { className: "btn alt small", type: "button", textContent: "Clear" }); body.append(clear);
      requestAnimationFrame(() => { pad.width = pad.clientWidth * 2; pad.height = pad.clientHeight * 2; });
      let last: number[] = null, width = 4;
      pad.addEventListener("pointerdown", (e) => { pad.setPointerCapture(e.pointerId); const r = pad.getBoundingClientRect(); last = [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2, e.timeStamp]; });
      pad.addEventListener("pointermove", (e) => {
        if (!last) return; const g = pad.getContext("2d"), r = pad.getBoundingClientRect();
        for (const ev of e.getCoalescedEvents?.() ?? [e]) {
          const x = (ev.clientX - r.left) * 2, y = (ev.clientY - r.top) * 2, v = Math.hypot(x - last[0], y - last[1]) / Math.max(1, ev.timeStamp - last[2]);
          width = width * 0.7 + clamp(6.2 - v * 1.4, 2, 6.2) * 0.3;
          g.strokeStyle = "#101c44"; g.lineCap = "round"; g.lineWidth = width; g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(x, y); g.stroke(); last = [x, y, ev.timeStamp];
        }
      });
      pad.addEventListener("pointerup", () => { last = null; finish(pad); });
      clear.onclick = () => { pad.getContext("2d").clearRect(0, 0, pad.width, pad.height); onReady(null); };
    } else if (mode === "type") {
      typed = el("input", { type: "text", placeholder: "Your name", "aria-label": "Your name" }); body.append(typed);
      typed.oninput = () => { const c = el("canvas", { width: 1200, height: 260 }), g = c.getContext("2d"); g.font = 'italic 120px "Snell Roundhand", "Segoe Script", "Brush Script MT", cursive'; g.fillStyle = "#101c44"; g.textBaseline = "middle"; g.fillText(typed.value, 20, 130); if (typed.value.trim()) finish(c); else onReady(null); };
    } else {
      const up = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", "aria-label": "Signature image" }); body.append(up);
      up.onchange = async () => {
        if (!up.files[0]) return; const bm = await createImageBitmap(up.files[0]), k = Math.min(1, 1200 / bm.width), c = el("canvas", { width: Math.round(bm.width * k), height: Math.round(bm.height * k) }), g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bm, 0, 0, c.width, c.height); const im = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < im.data.length; i += 4) { const l = 0.3 * im.data[i] + 0.59 * im.data[i + 1] + 0.11 * im.data[i + 2]; im.data[i + 3] = Math.min(im.data[i + 3], clamp((235 - l) * 3, 0, 255)); }
        g.putImageData(im, 0, 0); finish(c);
      };
    }
  };
  for (const [m, l] of [["draw", "Draw"], ["type", "Type"], ["upload", "Upload"]]) { const b = el("button", { type: "button", textContent: l, "data-m": m }); b.onclick = () => { mode = m; show(); }; seg.append(b); }
  host.append(seg, body); show();
}

export async function formFields(host: HTMLElement, f: In, values: Record<string, unknown>) {
  const fields = await pdfFields(f);
  host.replaceChildren();
  if (!fields.length) { host.append(el("p", { className: "alert", textContent: "This PDF has no fillable fields. Use Sign PDF to place text or a signature on it." })); return 0; }
  for (const x of fields) {
    values[x.name] = x.value; const id = `ff-${x.name.replace(/\W/g, "_")}`, label = x.name.replace(/[._]+/g, " ");
    if (x.kind === "CheckBox") { const i = el("input", { type: "checkbox", checked: !!x.value }); i.onchange = () => (values[x.name] = i.checked); host.append(el("label", { className: "check" }, label, i)); continue; }
    const wrap = el("div", { className: "field" }, el("label", { htmlFor: id, textContent: label }));
    if (x.options.length) { const s = el("select", { id }, el("option", { value: "", textContent: "Choose" }), ...x.options.map((o: string) => el("option", { value: o, textContent: o, selected: o === x.value }))); s.onchange = () => (values[x.name] = s.value); wrap.append(s); }
    else { const i = el("input", { id, type: "text", value: x.value ?? "" }); i.oninput = () => (values[x.name] = i.value); wrap.append(i); }
    host.append(wrap);
  }
  return fields.length;
}
