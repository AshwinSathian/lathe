import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFOperator, PDFRawStream, PDFRef, PDFStream, PDFString, PDFHexString, PDFContentStream, decodePDFRawStream, StandardFonts, degrees, popGraphicsState, pushGraphicsState, rgb, concatTransformationMatrix as concatTransformation, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList, type PDFFont, type PDFObject, type PDFPage } from "pdf-lib";
import { unzlibSync } from "fflate";
import { Say, bytesOf, eachFile as each, pagesIn, parseRanges, stem, zipOut, type Ctx, type In, type Out, type Run } from "./core";
import { EXT, MIME, encode, jpegIcc, load as loadImage, sniff, stripJpeg } from "./codecs";
import qpdfWasm from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";

const PDF_T = "application/pdf";
const SIZES: Record<string, [number, number]> = { a3: [841.89, 1190.55], a4: [595.28, 841.89], a5: [419.53, 595.28], letter: [612, 792], legal: [612, 1008] };
const color = (hex: string) => { const n = parseInt(hex.slice(1), 16); return rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const out = (name: string, bytes: Uint8Array, note?: string): Out => ({ name, type: PDF_T, bytes, note });
/** Writes only what the document still references, so text replaced in an earlier revision cannot ride along. */
const saved = async (d: PDFDocument, o: { updateFieldAppearances?: boolean } = {}) => { await d.flush(); collectGarbage(d); return d.save({ useObjectStreams: true, ...o }); };

/** Runs the qpdf command line in a fresh WebAssembly instance, one at a time because it borrows the global console. */
let qpdfTurn: Promise<unknown> = Promise.resolve();
function qpdf(input: Uint8Array, args: (i: string, o: string) => string[]) {
  const run = qpdfTurn.then(() => qpdfOnce(input, args));
  qpdfTurn = run.catch(() => {});
  return run;
}
async function qpdfOnce(input: Uint8Array, args: (i: string, o: string) => string[]) {
  const { default: create } = await import("@neslinesli93/qpdf-wasm");
  const log: string[] = [], { log: l, error: er } = console;
  // This qpdf build binds console when it is created, so its messages can only be read by standing in for console.
  console.log = console.error = (...a: unknown[]) => { log.push(a.join(" ")); };
  let m: any, code = 0;
  try {
    m = await (create as any)({ locateFile: () => qpdfWasm, noInitialRun: true });
    m.FS.writeFile("/in.pdf", input);
    try { code = m.callMain(args("/in.pdf", "/out.pdf")); } catch (e: any) { code = e?.status ?? 2; }
  } finally { console.log = l; console.error = er; }
  const text = log.join("\n");
  if (/invalid password/i.test(text)) throw new Say("That password is not correct for this PDF.");
  if (code !== 0 && code !== 3) throw new Say(`This PDF could not be processed: ${text.split("\n").pop() || "it may be badly damaged"}.`);
  return { bytes: m.FS.readFile("/out.pdf") as Uint8Array, log: text, warned: code === 3 };
}

const looksEncrypted = (b: Uint8Array) => { const tail = new TextDecoder("latin1").decode(b.subarray(Math.max(0, b.length - 4096))); return /\/Encrypt\b/.test(tail) || new TextDecoder("latin1").decode(b).includes("/Encrypt"); };

/** What a tool must tell the user about this input, recorded as each file is opened. */
const traits = new WeakMap<In, { signed: boolean; xfa: boolean; rich: string[]; restricted: boolean }>();
function readTraits(doc: PDFDocument, restricted: boolean) {
  const form = doc.catalog.lookup(PDFName.of("AcroForm")), names = doc.catalog.lookup(PDFName.of("Names")), fields = form instanceof PDFDict ? form.lookup(PDFName.of("Fields")) : null;
  const rich = [fields instanceof PDFArray && fields.size() ? "form fields" : "", names instanceof PDFDict && names.has(PDFName.of("EmbeddedFiles")) ? "attachments" : "", doc.catalog.has(PDFName.of("Outlines")) ? "bookmarks" : ""].filter(Boolean);
  const signed = doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFDict && o.has(PDFName.of("ByteRange")));
  return { signed, xfa: form instanceof PDFDict && form.has(PDFName.of("XFA")), rich, restricted };
}
const refuseXfa = (f: In) => { if (traits.get(f)?.xfa) throw new Say(`${f.name} is an XFA form, which Lathe cannot edit. Changing it here would delete the form.`); };

async function open(f: In, p: any = {}): Promise<{ doc: PDFDocument; bytes: Uint8Array }> {
  const loaded = (doc: PDFDocument, bytes: Uint8Array) => { traits.set(f, readTraits(doc, restricted)); return { doc, bytes }; };
  let restricted = !!f.restricted;
  let bytes: Uint8Array = await bytesOf(f);
  if (sniff(bytes) !== "pdf" && !new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF")) throw new Say(`${f.name} is not a PDF.`);
  if (looksEncrypted(bytes)) {
    try { bytes = (await qpdf(bytes, (i, o) => [`--password=${p.password ?? ""}`, "--decrypt", i, o])).bytes; restricted = !p.password; }
    catch (e) { if (e instanceof Say && /password/.test(e.message)) throw new Say(`${f.name} is password protected. Open it with Unlock PDF first.`); throw e; }
  }
  try { return loaded(await PDFDocument.load(bytes, { updateMetadata: false }), bytes); }
  catch {
    // A damaged file often loads once qpdf has rebuilt it.
    const fixed = (await qpdf(bytes, (i, o) => [i, o])).bytes;
    return loaded(await PDFDocument.load(fixed, { updateMetadata: false }), fixed);
  }
}

const isPage = (o: unknown) => o instanceof PDFDict && nameOf(o.lookup(PDFName.of("Type"))) === "Page";
/** True when following this object's references reaches a removed page, or an annotation that belongs to one. */
function reachesOther(ctx: PDFDocument["context"], start: unknown, keep: Set<PDFRef>, foreign: Set<unknown>) {
  const seen = new Set<unknown>(), stack = [start];
  while (stack.length) {
    const v = stack.pop();
    if (seen.has(v)) continue;
    seen.add(v);
    if (foreign.has(v)) return true;
    if (v instanceof PDFRef) { if (isPage(ctx.lookup(v))) { if (!keep.has(v)) return true; continue; } stack.push(ctx.lookup(v)); }
    else if (v instanceof PDFArray) stack.push(...v.asArray());
    else if (v instanceof PDFStream) stack.push(v.dict);
    else if (v instanceof PDFDict) stack.push(...v.values());
  }
  return false;
}

/** Every name a page's content mentions, or null if it cannot be read. A superset of what it draws, so nothing visible is pruned. */
function contentNames(doc: PDFDocument, page: PDFPage) {
  try {
    const c = page.node.Contents(), list = c instanceof PDFArray ? c.asArray().map((x) => doc.context.lookup(x)) : c ? [c] : [];
    let text = "";
    for (const st of list) text += new TextDecoder("latin1").decode(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : (st as PDFContentStream).getUnencodedContents()) + "\n";
    return new Set([...text.matchAll(/\/([^\s/<>[\]()%{}]+)/g)].map((m) => m[1].replace(/#([\da-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))));
  } catch { return null; }
}
/** An explicit destination on a link annotation, as [page, fit, ...]. */
function linkDest(a: PDFDict) {
  if (nameOf(a.lookup(PDFName.of("Subtype"))) !== "Link") return null;
  let dest = a.lookup(PDFName.of("Dest"));
  const act = a.lookup(PDFName.of("A"));
  if (!dest && act instanceof PDFDict && nameOf(act.lookup(PDFName.of("S"))) === "GoTo") dest = act.lookup(PDFName.of("D"));
  return dest instanceof PDFArray && dest.get(0) instanceof PDFRef ? dest : null;
}
/** Set when a kept page still draws something a removed page also drew, such as a logo. */
const reusesRemoved = new WeakSet<PDFDocument>();

/**
 * Copies pages without what they link to. pdf-lib follows every reference, so a link, form field or article thread
 * would otherwise bring a whole other page into the output, even a removed one. Links between kept pages are rebuilt.
 */
async function copyOnly(d: PDFDocument, src: PDFDocument, idx: number[], track = false) {
  const pages = src.getPages(), kept = [...new Set(idx)], keep = new Set(kept.map((i) => pages[i].ref)), removed = pages.filter((x) => !keep.has(x.ref)), undo: (() => void)[] = [];
  const foreign = new Set<unknown>(removed.flatMap((x) => x.node.Annots()?.asArray() ?? [])), links: { from: PDFRef; rect: PDFArray; to: PDFRef; rest: PDFObject[] }[] = [];
  const put = (dict: PDFDict, key: PDFName, value?: PDFObject) => { const was = dict.get(key); if (value) dict.set(key, value); else dict.delete(key); undo.push(() => { if (was) dict.set(key, was); else dict.delete(key); }); };
  const P = PDFName.of("P"), ANNOTS = PDFName.of("Annots"), RES = PDFName.of("Resources"), XO = PDFName.of("XObject");
  try {
    for (const i of kept) {
      const node = pages[i].node;
      for (const key of ["B", "AA"].map((k) => PDFName.of(k))) if (node.has(key)) put(node, key);
      for (const a of node.Annots()?.asArray() ?? []) { const o = src.context.lookup(a); if (o instanceof PDFDict && o.has(P)) put(o, P); }
      // Shared resource dictionaries can list images only a removed page draws.
      const res = node.Resources(), xo = res?.lookup(XO), names = removed.length && xo instanceof PDFDict ? contentNames(src, pages[i]) : null;
      if (names && xo instanceof PDFDict) {
        const nextXo = xo.clone(src.context);
        for (const key of xo.keys()) if (!names.has(key.decodeText())) nextXo.delete(key);
        if (nextXo.keys().length !== xo.keys().length) { const nextRes = res.clone(src.context); nextRes.set(XO, nextXo); put(node, RES, nextRes); }
      }
    }
    for (const i of kept) {
      const node = pages[i].node, annots = node.Annots();
      if (!annots) continue;
      const safe = annots.asArray().filter((a) => {
        const o = src.context.lookup(a);
        const dest = o instanceof PDFDict ? linkDest(o) : null, to = dest?.get(0) as PDFRef;
        if (to && pages.some((x) => x.ref === to)) { if (keep.has(to)) links.push({ from: pages[i].ref, rect: (o as PDFDict).lookup(PDFName.of("Rect")) as PDFArray, to, rest: dest.asArray().slice(1) }); return false; }
        return !reachesOther(src.context, o, new Set(), foreign);
      });
      if (safe.length !== annots.size()) put(node, ANNOTS, src.context.obj(safe));
    }
    if (track && removed.length) {
      const tree = pageTree(src), gone = new Set(removed.flatMap((x) => [...pageStreams(src, x, tree, true)]));
      if (kept.some((i) => sharesHidden(src, pages[i], gone, tree))) reusesRemoved.add(d);
    }
    const before = new Set(d.context.enumerateIndirectObjects().map(([ref]) => ref));
    const copied = await d.copyPages(src, idx), known = new Set(copied.map((x) => x.ref)), target = new Map<PDFRef, PDFPage>();
    // Fail closed: if this copy brought in any page beyond the selection, write nothing.
    for (const [ref, o] of d.context.enumerateIndirectObjects()) if (!before.has(ref) && isPage(o) && !known.has(ref)) throw new Say("This PDF links its pages in a way Lathe cannot separate safely, so no file was written.");
    idx.forEach((i, k) => { if (!target.has(pages[i].ref)) target.set(pages[i].ref, copied[k]); });
    for (const l of links) if (l.rect instanceof PDFArray) target.get(l.from).node.addAnnot(d.context.register(d.context.obj({ Type: "Annot", Subtype: "Link", Rect: l.rect.clone(d.context), Border: [0, 0, 0], Dest: [target.get(l.to).ref, ...l.rest.filter((x) => !(x instanceof PDFRef))] })));
    return copied;
  } finally { undo.reverse().forEach((f) => f()); }
}
const copy = async (src: PDFDocument, idx: number[], track = false) => { const d = await PDFDocument.create(); (await copyOnly(d, src, idx, track)).forEach((x) => d.addPage(x)); return d; };
/** Rebuilds every page from pixels, so nothing the pages merely reference can remain. */
async function asImages(bytes: Uint8Array, ctx: Ctx, dpi = 200) {
  const src = await PDFDocument.load(bytes), d = await PDFDocument.create(), key = crypto.randomUUID();
  for (let i = 0; i < src.getPageCount(); i++) {
    ctx.progress(i / src.getPageCount(), `Rebuilding page ${i + 1}`);
    const b = await render(ctx, bytes, key, i, dpi), v = visual(src.getPage(i)), im = await d.embedJpg(await encode(toImg(b), "jpeg", 90));
    b.close(); d.addPage([v.W, v.H]).drawImage(im, { x: 0, y: 0, width: v.W, height: v.H });
  }
  return saved(d);
}
/** Saves a page-removal result. With `secure`, a result that reuses removed content is rebuilt from pixels. */
async function finishRemoval(d: PDFDocument, p: any, ctx: Ctx) {
  const reused = reusesRemoved.has(d), bytes = await saved(d);
  if (reused && p.secure) return { bytes: await asImages(bytes, ctx), note: " Pages were rebuilt as images, so nothing from the removed pages remains.", reused: false };
  return { bytes, note: reused ? " A kept page reuses content from a removed page, such as a logo. Use Remove securely to rebuild the pages as images, or Redact PDF to black out what remains." : "", reused };
}
/** The real page tree, walked down from the catalog through /Kids, so a forged /Parent or /Type cannot add to it. */
function pageTree(doc: PDFDocument) {
  const leaves = new Set<unknown>(doc.getPages().map((x) => x.ref)), nodes = new Set<unknown>(), stack: unknown[] = [doc.catalog.get(PDFName.of("Pages"))];
  while (stack.length) {
    const r = stack.pop();
    if (!(r instanceof PDFRef) || nodes.has(r) || leaves.has(r)) continue;
    const o = doc.context.lookup(r), kids = o instanceof PDFDict ? o.lookup(PDFName.of("Kids")) : null;
    if (!(kids instanceof PDFArray)) continue;
    nodes.add(r); stack.push(...kids.asArray());
  }
  return { leaves, nodes };
}
type PageTree = ReturnType<typeof pageTree>;
const FONT_KEYS = new Set(["Type", "Subtype", "BaseFont", "Name", "FirstChar", "LastChar", "Widths", "FontDescriptor", "Encoding", "ToUnicode", "DescendantFonts"].map((k) => PDFName.of(k)));
const FONT_TYPES = new Set(["Type0", "Type1", "MMType1", "TrueType"]);
const isOrdinaryFont = (o: unknown): o is PDFDict => o instanceof PDFDict && nameOf(o.lookup(PDFName.of("Type"))) === "Font" && FONT_TYPES.has(nameOf(o.lookup(PDFName.of("Subtype")))) && o.has(PDFName.of("BaseFont"));
/** A colour space that is exactly [/ICCBased profile], where the stream has /N and the ICC file signature. */
function isIccSpace(doc: PDFDocument, v: unknown) {
  const a = doc.context.lookup(v as PDFRef);
  if (!(a instanceof PDFArray) || a.size() !== 2 || a.lookup(0) !== PDFName.of("ICCBased")) return false;
  const o = a.lookup(1);
  if (!(o instanceof PDFStream) || !o.dict.has(PDFName.of("N")) || o.dict.has(PDFName.of("Subtype"))) return false;
  try { const b = o instanceof PDFRawStream ? decodePDFRawStream(o).decode() : o.getContents(); return String.fromCharCode(...b.subarray(36, 40)) === "acsp"; }
  catch { return false; }
}
/**
 * Streams reachable from a page. With `shown`, font programs and ICC profiles are left out, because documents share
 * them by design and they hold no page content. They are left out only where the PDF structure puts them: a font in a
 * /Resources /Font map, a profile in a /ColorSpace entry. A label anywhere else changes nothing.
 * Without `shown`, nothing is left out, so a kept page cannot hide a stream behind a mislabelled object.
 */
function pageStreams(doc: PDFDocument, page: PDFPage, tree: PageTree, shown: boolean) {
  const found = new Set<PDFRef>(), seen = new Set<unknown>(), maps = new Set<unknown>(), stack: unknown[] = [];
  const [parent, kids, RES, FONT, CS] = ["Parent", "Kids", "Resources", "Font", "ColorSpace"].map((k) => PDFName.of(k));
  const resources = (x: unknown) => {
    const r = doc.context.lookup(x as PDFRef);
    if (!(r instanceof PDFDict)) return void stack.push(x);
    if (maps.has(r)) return;
    maps.add(r);
    for (const [k, v] of r.entries()) {
      const map = doc.context.lookup(v as PDFRef);
      if ((k === FONT || k === CS) && map instanceof PDFDict) {
        for (const item of map.values()) {
          const o = doc.context.lookup(item as PDFRef);
          if (k === CS ? isIccSpace(doc, item) : false) continue;
          if (k === FONT && isOrdinaryFont(o)) { for (const [fk, fv] of o.entries()) if (!FONT_KEYS.has(fk)) stack.push(fv); continue; }
          stack.push(item);
        }
      } else stack.push(v);
    }
  };
  const entries = (d: PDFDict) => {
    const image = nameOf(d.lookup(PDFName.of("Subtype"))) === "Image";
    for (const [k, v] of d.entries()) {
      if (shown && k === RES) resources(v);
      else if (!(shown && image && k === CS && isIccSpace(doc, v))) stack.push(v);
    }
  };
  for (const [k, v] of page.node.entries()) if (k !== parent && k !== RES) stack.push(v);
  if (shown) resources(page.node.Resources()); else stack.push(page.node.Resources());
  while (stack.length) {
    const v = stack.pop();
    if (!v || seen.has(v) || tree.leaves.has(v)) continue;
    seen.add(v);
    if (v instanceof PDFRef) {
      const o = doc.context.lookup(v);
      // A tree node can hold inherited resources, so only its links to other pages are skipped.
      if (tree.nodes.has(v)) { stack.push(...(o as PDFDict).entries().filter(([k]) => k !== parent && k !== kids).map(([, x]) => x)); continue; }
      // Annotations and their text can be shared by reference, and then show on every page that lists them.
      if (o instanceof PDFStream || o instanceof PDFString || o instanceof PDFHexString || (o instanceof PDFDict && o.has(PDFName.of("Subtype")) && o.has(PDFName.of("Rect")))) found.add(v);
      stack.push(o);
    } else if (v instanceof PDFArray) stack.push(...v.asArray());
    else if (v instanceof PDFStream) entries(v.dict);
    else if (v instanceof PDFDict) entries(v);
  }
  return found;
}
/** A kept page that can reach anything a redacted page shows is flattened, because it might show only part of it. */
const sharesHidden = (doc: PDFDocument, page: PDFPage, hidden: Set<PDFRef>, tree: PageTree) => [...pageStreams(doc, page, tree, false)].some((x) => hidden.has(x));

const render = (ctx: Ctx, bytes: Uint8Array, key: string, page: number, dpi: number, gray = false) => ctx.main<ImageBitmap>("render", { doc: new Blob([bytes as BlobPart]), key, page, dpi, gray });
const toImg = (b: ImageBitmap) => { const c = new OffscreenCanvas(b.width, b.height), g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(b, 0, 0); return g.getImageData(0, 0, c.width, c.height); };

/** The page as a reader sees it, whatever its /Rotate and crop box. */
function visual(page: PDFPage) {
  const c = page.getCropBox(), r = ((page.getRotation().angle % 360) + 360) % 360, sw = r % 180 !== 0;
  const W = sw ? c.height : c.width, H = sw ? c.width : c.height;
  const m = r === 90 ? [0, 1, -1, 0, c.x + c.width, c.y] : r === 180 ? [-1, 0, 0, -1, c.x + c.width, c.y + c.height] : r === 270 ? [0, -1, 1, 0, c.x, c.y + c.height] : [1, 0, 0, 1, c.x, c.y];
  return { W, H, begin: () => page.pushOperators(pushGraphicsState(), concatTransformation(m[0], m[1], m[2], m[3], m[4], m[5])), end: () => page.pushOperators(popGraphicsState()) };
}
const winAnsi = (t: string, font: PDFFont) => { try { font.encodeText(t); return true; } catch { return false; } };

/** Text in any script: real PDF text where the standard fonts can hold it, a crisp image where they cannot. */
async function stamp(doc: PDFDocument, page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, col: string, opacity = 1, rotate = 0) {
  if (winAnsi(text, font)) { page.drawText(text, { x, y, size, font, color: color(col), opacity, rotate: degrees(rotate) }); return; }
  const k = 4, probe = new OffscreenCanvas(1, 1).getContext("2d"), css = `${size * k}px -apple-system, "Segoe UI", "Noto Sans", sans-serif`;
  probe.font = css;
  const w = Math.ceil(probe.measureText(text).width), h = Math.ceil(size * k * 1.5), c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  g.font = css; g.fillStyle = col; g.textBaseline = "alphabetic"; g.fillText(text, 0, size * k * 1.1);
  const png = await doc.embedPng(new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer()));
  page.drawImage(png, { x, y: y - size * 0.4, width: w / k, height: h / k, opacity, rotate: degrees(rotate) });
}
const textWidth = (font: PDFFont, t: string, size: number) => (winAnsi(t, font) ? font.widthOfTextAtSize(t, size) : t.length * size * 0.6);

function addOutline(doc: PDFDocument, items: { title: string; page: number }[]) {
  const ctx = doc.context, root = ctx.nextRef(), refs = items.map(() => ctx.nextRef()), pages = doc.getPages();
  items.forEach((it, i) => {
    const d: Record<string, any> = { Title: PDFHexString.fromText(it.title), Parent: root, Dest: ctx.obj([pages[it.page].ref, PDFName.of("Fit")]) };
    if (i) d.Prev = refs[i - 1];
    if (i < items.length - 1) d.Next = refs[i + 1];
    ctx.assign(refs[i], ctx.obj(d));
  });
  ctx.assign(root, ctx.obj({ Type: "Outlines", First: refs[0], Last: refs[refs.length - 1], Count: items.length }));
  doc.catalog.set(PDFName.of("Outlines"), root);
}

const nameOf = (v: any) => (v instanceof PDFName ? v.decodeText() : v instanceof PDFArray && v.size() ? nameOf(v.lookup(0)) : "");
const numOf = (d: PDFDict, k: string) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : 0; };

/** Downsamples embedded images in place. Text and vectors are never touched. */
/**
 * The size each image is really drawn at, in points, found by following the page content.
 * An image that is also reached any other way is left out, so it keeps its full resolution.
 */
function drawnSizes(doc: PDFDocument) {
  const size = new Map<PDFRef, { w: number; h: number }>(), unknown = new Set<PDFRef>();
  const X = (m: number[], n: number[]) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const isImage = (o: unknown) => o instanceof PDFStream && nameOf(o.dict.lookup(PDFName.of("Subtype"))) === "Image";
  const mark = (v: unknown, seen = new Set<unknown>()) => {
    if (!v || seen.has(v)) return; seen.add(v);
    if (v instanceof PDFRef) { const o = doc.context.lookup(v); if (isImage(o)) unknown.add(v); mark(o, seen); }
    else if (v instanceof PDFArray) v.asArray().forEach((x) => mark(x, seen));
    else if (v instanceof PDFStream) mark(v.dict, seen);
    else if (v instanceof PDFDict) v.values().forEach((x) => mark(x, seen));
  };
  const text = (st: unknown) => new TextDecoder("latin1").decode(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : (st as PDFContentStream).getUnencodedContents());
  const walk = (src: string, res: PDFDict | undefined, base: number[], path: Set<unknown>) => {
    const xo = res?.lookup(PDFName.of("XObject"));
    for (const k of ["Pattern", "ExtGState", "Font"]) mark(res?.lookup(PDFName.of(k)));
    if (/\bBI\b/.test(src)) { mark(xo); return; }
    const tokens = src.replace(/\((?:\\.|[^\\()])*\)|<[^<>]*>/g, " ").match(/[-+]?(?:\d+\.?\d*|\.\d+)|\/[^\s/<>[\]()]+|[A-Za-z'"*]+/g) ?? [];
    let m = base, nums: number[] = [], name = ""; const stack: number[][] = [];
    for (const t of tokens) {
      if (/^[-+.\d]/.test(t)) { nums.push(+t); continue; }
      if (t[0] === "/") { name = t.slice(1).replace(/#([\da-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); continue; }
      if (t === "q") stack.push(m); else if (t === "Q") m = stack.pop() ?? base; else if (t === "cm" && nums.length >= 6) m = X(m, nums.slice(-6));
      else if (t === "Do" && xo instanceof PDFDict) {
        const ref = xo.get(PDFName.of(name)), o = ref instanceof PDFRef ? doc.context.lookup(ref) : null;
        if (isImage(o)) { const w = Math.hypot(m[0], m[1]), h = Math.hypot(m[2], m[3]), was = size.get(ref as PDFRef); size.set(ref as PDFRef, { w: Math.max(w, was?.w ?? 0), h: Math.max(h, was?.h ?? 0) }); }
        else if (o instanceof PDFStream && !path.has(o)) {
          const fm = o.dict.lookup(PDFName.of("Matrix")), inner = fm instanceof PDFArray && fm.size() === 6 ? X(m, fm.asArray().map((x) => (x as PDFNumber).asNumber())) : m, own = o.dict.lookup(PDFName.of("Resources"));
          walk(text(o), own instanceof PDFDict ? own : res, inner, new Set([...path, o]));
        }
      }
      nums = [];
    }
  };
  try {
    for (const page of doc.getPages()) {
      const c = page.node.Contents(), list = c instanceof PDFArray ? c.asArray().map((x) => doc.context.lookup(x)) : c ? [c] : [], unit = numOf(page.node, "UserUnit") || 1;
      walk(list.map(text).join("\n"), page.node.Resources(), [unit, 0, 0, unit, 0, 0], new Set());
      mark(page.node.Annots());
    }
  } catch { return null; }
  for (const r of unknown) size.delete(r);
  return size;
}
/** Only colour that survives a round trip through the browser's decoder is re-encoded. */
function plainColour(doc: PDFDocument, d: PDFDict) {
  const cs = d.lookup(PDFName.of("ColorSpace"));
  if (d.has(PDFName.of("Decode"))) return null;
  if (cs === PDFName.of("DeviceRGB")) return { ch: 3, keep: false };
  if (cs === PDFName.of("DeviceGray")) return { ch: 1, keep: false };
  if (!isIccSpace(doc, d.get(PDFName.of("ColorSpace")))) return null;
  return numOf(((cs as PDFArray).lookup(1) as PDFStream).dict, "N") === 3 ? { ch: 3, keep: true } : null;
}
async function shrinkImages(doc: PDFDocument, dpi: number, q: number, ctx: Ctx) {
  const drawn = drawnSizes(doc);
  const list = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && nameOf(o.dict.lookup(PDFName.of("Subtype"))) === "Image") as [PDFRef, PDFRawStream][];
  let changed = 0;
  for (let i = 0; i < list.length; i++) {
    const [ref, s] = list[i], d = s.dict; ctx.progress(0.1 + (i / list.length) * 0.75, `Recompressing image ${i + 1} of ${list.length}`);
    const w = numOf(d, "Width"), h = numOf(d, "Height"), bpc = numOf(d, "BitsPerComponent"), filter = nameOf(d.lookup(PDFName.of("Filter"))), colour = plainColour(doc, d);
    if (w * h < 4096 || !colour || d.has(PDFName.of("ImageMask")) || d.has(PDFName.of("Mask"))) continue;
    // A soft mask is a grayscale image too, and it must keep its pixel values exact enough to stay transparent.
    if (doc.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("SMask")) === ref)) continue;
    // A premultiplied image (/Matte) must stay exactly the size of its mask.
    const mask = d.lookup(PDFName.of("SMask")); if (mask instanceof PDFStream && mask.dict.has(PDFName.of("Matte"))) continue;
    let img: ImageData;
    try {
      if (filter === "DCTDecode") {
        const b = await createImageBitmap(new Blob([s.contents as BlobPart], { type: "image/jpeg" }), { colorSpaceConversion: "none" }); img = toImg(b);
      } else if (filter === "FlateDecode" && bpc === 8 && !d.has(PDFName.of("DecodeParms"))) {
        const raw = unzlibSync(s.contents), ch = colour.ch;
        if (raw.length < w * h * ch) continue;
        img = new ImageData(w, h);
        for (let k = 0, o = 0; k < w * h; k++, o += ch) { img.data[k * 4] = raw[o]; img.data[k * 4 + 1] = raw[ch === 3 ? o + 1 : o]; img.data[k * 4 + 2] = raw[ch === 3 ? o + 2 : o]; img.data[k * 4 + 3] = 255; }
      } else continue;
    } catch { continue; }
    // Pixels needed at the target resolution for the largest placement. An image with no known placement keeps them all.
    const at = drawn?.get(ref), k = at ? Math.min(1, Math.max((at.w / 72) * dpi / w, (at.h / 72) * dpi / h)) : 1, nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
    const c = new OffscreenCanvas(nw, nh), g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high";
    g.drawImage(await createImageBitmap(img), 0, 0, nw, nh);
    const jpg = await encode(g.getImageData(0, 0, nw, nh), "jpeg", q);
    if (jpg.length >= s.contents.length) continue;
    const nd = d.clone(doc.context);
    for (const key of ["Filter", "DecodeParms", "Length"]) nd.delete(PDFName.of(key));
    nd.set(PDFName.of("Filter"), PDFName.of("DCTDecode")); nd.set(PDFName.of("Width"), PDFNumber.of(nw)); nd.set(PDFName.of("Height"), PDFNumber.of(nh)); nd.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8)); if (!colour.keep) nd.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    doc.context.assign(ref, PDFRawStream.of(nd, jpg)); changed++;
  }
  return changed;
}

/** Whether optional content shows in the default view. Null means Lathe cannot tell, for example with a visibility expression. */
function layerShown(doc: PDFDocument, oc: unknown): boolean | null {
  const d = doc.context.lookup(oc as PDFRef);
  if (!d) return true;
  if (!(d instanceof PDFDict)) return null;
  const props = doc.catalog.lookup(PDFName.of("OCProperties")), cfg = props instanceof PDFDict ? props.lookup(PDFName.of("D")) : null;
  const listed = (k: string, ref: unknown) => { const a = cfg instanceof PDFDict ? cfg.lookup(PDFName.of(k)) : null; return a instanceof PDFArray && a.asArray().includes(ref as PDFObject); };
  const one = (ref: unknown) => (listed("OFF", ref) ? false : cfg instanceof PDFDict && nameOf(cfg.lookup(PDFName.of("BaseState"))) === "OFF" ? listed("ON", ref) : true);
  if (nameOf(d.lookup(PDFName.of("Type"))) === "OCG") return one(oc);
  if (nameOf(d.lookup(PDFName.of("Type"))) !== "OCMD" || d.has(PDFName.of("VE"))) return null;
  const g = d.get(PDFName.of("OCGs")), list = g instanceof PDFRef && !(doc.context.lookup(g) instanceof PDFArray) ? [g] : (doc.context.lookup(g) as PDFArray)?.asArray?.() ?? [];
  if (!list.length) return true;
  const on = list.map(one), policy = nameOf(d.lookup(PDFName.of("P"))) || "AnyOn";
  return policy === "AllOn" ? on.every(Boolean) : policy === "AnyOff" ? on.some((x) => !x) : policy === "AllOff" ? on.every((x) => !x) : on.some(Boolean);
}
/**
 * Bakes annotation appearances into page content. Hidden annotations stay out of the page.
 * One with no appearance to bake is kept as it is, and the number kept is returned.
 */
function flattenAnnots(doc: PDFDocument) {
  let keptTotal = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots(); if (!annots) continue;
    const kept: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i); if (!(a instanceof PDFDict)) continue;
      if (numOf(a, "F") & 0b100010) continue; // Hidden or NoView
      const keep = () => { if (nameOf(a.lookup(PDFName.of("Subtype"))) !== "Widget") kept.push(annots.get(i)); };
      const shown = a.has(PDFName.of("OC")) ? layerShown(doc, a.get(PDFName.of("OC"))) : true;
      if (shown === false) continue;
      if (shown === null) { keep(); continue; } // Never bake in what might be hidden.
      const ap = a.lookup(PDFName.of("AP")); if (!(ap instanceof PDFDict)) { keep(); continue; }
      let n: any = ap.get(PDFName.of("N")), obj = doc.context.lookup(n);
      if (obj instanceof PDFDict && !(obj instanceof PDFStream)) { const st = a.lookup(PDFName.of("AS")); n = st instanceof PDFName ? obj.get(st) : undefined; obj = n && doc.context.lookup(n); }
      if (!(obj instanceof PDFStream) || !(n instanceof PDFRef)) { keep(); continue; }
      const formLayer = obj.dict.has(PDFName.of("OC")) ? layerShown(doc, obj.dict.get(PDFName.of("OC"))) : true;
      if (formLayer === false) continue;
      if (formLayer === null) { keep(); continue; }
      const rect = (a.lookup(PDFName.of("Rect")) as PDFArray)?.asRectangle?.(), bb = obj.dict.lookup(PDFName.of("BBox")) as PDFArray;
      if (!rect || !bb) { keep(); continue; }
      const b = bb.asRectangle(), sx = b.width ? rect.width / b.width : 1, sy = b.height ? rect.height / b.height : 1, name = page.node.newXObject("Flat", n);
      page.pushOperators(pushGraphicsState(), concatTransformation(sx, 0, 0, sy, rect.x - b.x * sx, rect.y - b.y * sy), PDFOperator.of("Do" as any, [name]), popGraphicsState());
    }
    if (kept.length) page.node.set(PDFName.of("Annots"), doc.context.obj(kept)); else page.node.delete(PDFName.of("Annots"));
    keptTotal += kept.length;
  }
  doc.catalog.delete(PDFName.of("AcroForm"));
  return keptTotal;
}

/** Web and mail links only, hex-encoded so a crafted URL cannot break out of the PDF string. */
function safeUri(href: string) {
  try {
    const u = new URL(href);
    if (!["http:", "https:", "mailto:"].includes(u.protocol)) return null;
    return PDFHexString.of([...new TextEncoder().encode(u.href)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  } catch { return null; }
}

/** Deletes every object the document no longer references, so removed metadata cannot survive as an orphan. */
function collectGarbage(doc: PDFDocument) {
  const live = new Set<PDFRef>(), stack: unknown[] = [doc.context.trailerInfo.Root, doc.context.trailerInfo.Info];
  while (stack.length) {
    const v = stack.pop();
    if (v instanceof PDFRef) { if (!live.has(v)) { live.add(v); stack.push(doc.context.lookup(v)); } }
    else if (v instanceof PDFArray) stack.push(...v.asArray());
    else if (v instanceof PDFStream) stack.push(v.dict);
    else if (v instanceof PDFDict) stack.push(...v.values());
  }
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!live.has(ref)) doc.context.delete(ref);
}

async function markdownPdf(md: string, p: any) {
  const { marked } = await import("marked");
  const doc = await PDFDocument.create(), [PW, PH] = SIZES[p.size], M = 64, W = PW - 2 * M;
  const serif = p.font === "serif";
  const F = {
    r: await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica), b: await doc.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold),
    i: await doc.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique), c: await doc.embedFont(StandardFonts.Courier),
  };
  let page = doc.addPage([PW, PH]), y = PH - M;
  const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
  const clean = (t: string) => t.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => entities[m]).replace(/\t/g, "  ").replace(/\u2192/g, "->").replace(/[^\x20-\x7e\xa0-\xff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/g, "?");
  const need = (h: number) => { if (y - h < M) { page = doc.addPage([PW, PH]); y = PH - M; } };
  type Run = { t: string; f: PDFFont; c?: boolean; href?: string };
  const runs = (toks: any[], f: PDFFont = F.r, href?: string): Run[] => (toks ?? []).flatMap((x) => {
    if (x.type === "strong") return runs(x.tokens, F.b, href);
    if (x.type === "em") return runs(x.tokens, F.i, href);
    if (x.type === "codespan") return [{ t: clean(x.text), f: F.c, c: true, href }];
    if (x.type === "link") return runs(x.tokens, f, x.href);
    if (x.type === "br") return [{ t: "\n", f }];
    if (x.tokens) return runs(x.tokens, f, href);
    return [{ t: clean(x.text ?? x.raw ?? ""), f, href }];
  });
  const flow = (rs: Run[], size: number, x0: number, width: number, lead: number) => {
    const words = rs.flatMap((r) => r.t.split(/(\s+)/).filter((w) => w !== "").map((w) => ({ ...r, t: w })));
    let line: typeof words = [], lw = 0;
    const flush = () => {
      while (line.length && /^\s+$/.test(line[line.length - 1].t)) line.pop();
      need(lead); let x = x0;
      for (const w of line) {
        const s = w.c ? size * 0.88 : size, tw = w.f.widthOfTextAtSize(w.t, s);
        if (!/^\s+$/.test(w.t)) page.drawText(w.t, { x, y: y - size, size: s, font: w.f, color: w.href ? rgb(0.75, 0.25, 0.05) : rgb(0.1, 0.09, 0.08) });
        const uri = w.href && !/^\s+$/.test(w.t) ? safeUri(w.href) : null;
        if (uri) {
          const link = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, y - size - 2, x + tw, y], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: uri } }));
          page.node.addAnnot(link);
        }
        x += tw;
      }
      y -= lead; line = []; lw = 0;
    };
    for (const w of words) {
      if (w.t.includes("\n")) { flush(); continue; }
      const tw = w.f.widthOfTextAtSize(w.t, w.c ? size * 0.88 : size);
      if (lw + tw > width && line.length) { flush(); if (/^\s+$/.test(w.t)) continue; }
      line.push(w); lw += tw;
    }
    if (line.length) flush();
  };
  const block = (toks: any[], x0: number, width: number) => {
    for (const t of toks) {
      if (t.type === "heading") { const s = [0, 24, 18, 15, 13, 12, 11][t.depth]; y -= s * 0.7; need(s * 2.2); flow(runs(t.tokens, F.b), s, x0, width, s * 1.25); y -= s * 0.3; }
      else if (t.type === "paragraph" || t.type === "text") { flow(runs(t.tokens ?? [{ text: t.text }]), 11, x0, width, 15.5); if (t.type === "paragraph") y -= 7; }
      else if (t.type === "list") {
        t.items.forEach((it: any, i: number) => { need(16); page.drawText(t.ordered ? `${(t.start || 1) + i}.` : "•", { x: x0 + 2, y: y - 11, size: 11, font: F.r, color: rgb(0.1, 0.09, 0.08) }); block(it.tokens, x0 + 18, width - 18); });
        y -= 6;
      } else if (t.type === "blockquote") {
        const start = y, first = page; block(t.tokens, x0 + 14, width - 14);
        if (first === page) page.drawLine({ start: { x: x0 + 2, y: start }, end: { x: x0 + 2, y: y + 7 }, thickness: 2, color: rgb(0.8, 0.77, 0.7) });
      } else if (t.type === "code") {
        const lines = clean(t.text).split("\n").flatMap((l) => { const max = Math.floor((width - 16) / (9 * 0.6)), o = []; for (let i = 0; i < Math.max(l.length, 1); i += max) o.push(l.slice(i, i + max)); return o; });
        for (const l of lines) { need(13); page.drawRectangle({ x: x0, y: y - 13, width, height: 13, color: rgb(0.95, 0.94, 0.91) }); if (l) page.drawText(l, { x: x0 + 8, y: y - 10, size: 9, font: F.c, color: rgb(0.15, 0.14, 0.12) }); y -= 13; }
        y -= 9;
      } else if (t.type === "hr") { need(16); page.drawLine({ start: { x: x0, y: y - 8 }, end: { x: x0 + width, y: y - 8 }, thickness: 0.6, color: rgb(0.8, 0.77, 0.7) }); y -= 18; }
      else if (t.type === "table") {
        const cols = t.header.length, cw = width / cols;
        for (const row of [t.header, ...t.rows]) {
          need(18); const isHead = row === t.header;
          row.forEach((cell: any, i: number) => { let s = clean(cell.text); const f = isHead ? F.b : F.r; while (s && f.widthOfTextAtSize(s, 9.5) > cw - 6) s = s.slice(0, -1); page.drawText(s, { x: x0 + i * cw + 3, y: y - 12, size: 9.5, font: f, color: rgb(0.1, 0.09, 0.08) }); });
          page.drawLine({ start: { x: x0, y: y - 17 }, end: { x: x0 + width, y: y - 17 }, thickness: 0.4, color: rgb(0.85, 0.82, 0.76) }); y -= 18;
        }
        y -= 8;
      }
    }
  };
  block(marked.lexer(md), M, W);
  return saved(doc);
}

function textFromItems(items: { str: string; x: number; y: number; h: number; w: number }[], md: boolean, body: number) {
  const lines: { y: number; h: number; parts: typeof items }[] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!it.str.trim() && !it.w) continue;
    const l = lines.find((q) => Math.abs(q.y - it.y) < Math.max(q.h, it.h) * 0.45);
    if (l) { l.parts.push(it); l.h = Math.max(l.h, it.h); } else lines.push({ y: it.y, h: it.h, parts: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  const o: string[] = []; let prev: (typeof lines)[0];
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let s = "", end = -1e9;
    for (const q of l.parts) { if (s && q.x - end > l.h * 0.18 && !s.endsWith(" ") && !q.str.startsWith(" ")) s += " "; s += q.str; end = q.x + q.w; }
    s = s.trimEnd(); if (!s.trim()) continue;
    if (prev && prev.y - l.y > Math.max(prev.h, l.h) * 1.75) o.push("");
    if (md) { const ratio = l.h / (body || 1); if (ratio > 1.7) s = `# ${s}`; else if (ratio > 1.35) s = `## ${s}`; else if (ratio > 1.14) s = `### ${s}`; if (s.startsWith("#")) { if (o.length && o[o.length - 1]) o.push(""); o.push(s, ""); prev = l; continue; } }
    o.push(s); prev = l;
  }
  return o.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Content a metadata wipe deliberately leaves, because removing it would change the document. */
function stillInside(doc: PDFDocument) {
  const objs = doc.context.enumerateIndirectObjects().map(([, o]) => o), names = doc.catalog.lookup(PDFName.of("Names"));
  const comment = objs.some((o) => o instanceof PDFDict && o.has(PDFName.of("Rect")) && o.has(PDFName.of("Contents")) && nameOf(o.lookup(PDFName.of("Subtype"))) !== "Widget");
  const script = doc.catalog.has(PDFName.of("OpenAction")) || (names instanceof PDFDict && names.has(PDFName.of("JavaScript"))) || objs.some((o) => o instanceof PDFDict && nameOf(o.lookup(PDFName.of("S"))) === "JavaScript");
  return [comment ? "comments" : "", ...readTraits(doc, false).rich, script ? "scripts" : "", doc.catalog.has(PDFName.of("OCProperties")) ? "layer names" : ""].filter(Boolean);
}
/** Draws what a reader sees of a page, whatever its crop box and rotation, with its lower left corner at x, y. */
async function drawVisible(d: PDFDocument, sheet: PDFPage, src: PDFPage, x: number, y: number, k: number) {
  const c = src.getCropBox(), r = ((src.getRotation().angle % 360) + 360) % 360, ew = c.width * k, eh = c.height * k;
  const em = await d.embedPage(src, { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height });
  const at = r === 90 ? { x, y: y + ew } : r === 180 ? { x: x + ew, y: y + eh } : r === 270 ? { x: x + eh, y } : { x, y };
  sheet.drawPage(em, { ...at, xScale: k, yScale: k, rotate: degrees(-r) });
}
const DROPS_STRUCTURE = new Set(["merge-pdf", "split-pdf", "organize-pdf", "extract-pages", "delete-pages", "resize-pdf", "n-up-pdf", "booklet-pdf"]);
/** Adds what every PDF-writing tool must disclose about its input, in one place. */
function disclosed(tools: Record<string, Run>) {
  for (const [id, run] of Object.entries(tools)) tools[id] = async (files, p, ctx) => {
    const outs = await run(files, p, ctx), seen = files.map((f) => traits.get(f)).filter(Boolean), extra: string[] = [];
    if (seen.some((x) => x.signed)) extra.push("This file had a digital signature, which any change invalidates. Keep the original if you need it.");
    if (seen.some((x) => x.restricted)) extra.push("The original's permission restrictions are not kept in this file.");
    const lost = [...new Set(seen.flatMap((x) => x.rich))];
    if (lost.length && DROPS_STRUCTURE.has(id)) extra.push(`Not carried over: ${lost.join(", ")}.`);
    if (extra.length) for (const o of outs) if (o.type === PDF_T || (id === "split-pdf" && o.type === "application/zip")) o.note = [o.note, ...extra].filter(Boolean).join(" ");
    return outs;
  };
  return tools;
}

export const pdfTools: Record<string, Run> = disclosed({
  /** Rewrites a file at intake, so the preview and the editing engine read one unambiguous structure. */
  "prepare-pdf": async ([f], p, ctx) => {
    const input = await bytesOf(f);
    if (!new TextDecoder("latin1").decode(input.subarray(0, 1024)).includes("%PDF")) return [{ name: f.name, type: PDF_T }];
    // A text search for /Encrypt can be fooled, so every file goes through qpdf. Only a real password stops it here.
    let r: Awaited<ReturnType<typeof qpdf>>;
    try { r = await qpdf(input, (i, o) => ["--password=", "--decrypt", i, o]); }
    catch (e) { if (e instanceof Say && /password/.test(e.message)) return [{ name: f.name, type: PDF_T }]; throw e; }
    const bytes = r.bytes, repaired = r.warned;
    const restricted = !!(await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false })).context.trailerInfo.Encrypt;
    const shown = await ctx.main<number>("pageCount", { doc: new Blob([bytes as BlobPart]), key: crypto.randomUUID() });
    if (shown !== (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()) throw new Say(`${f.name} has a page structure Lathe cannot read reliably, so it was not opened.`);
    const t = readTraits(await PDFDocument.load(bytes, { updateMetadata: false }), false);
    return [{ name: f.name, type: PDF_T, bytes, text: JSON.stringify({ signed: t.signed, repaired, restricted }) }];
  },
  "merge-pdf": async (files, p, ctx) => {
    const d = await PDFDocument.create(), marks: { title: string; page: number }[] = [];
    for (let i = 0; i < files.length; i++) {
      ctx.progress(i / files.length, `Adding ${files[i].name}`);
      const { doc } = await open(files[i]);
      marks.push({ title: stem(files[i].name), page: d.getPageCount() });
      (await copyOnly(d, doc, doc.getPageIndices())).forEach((x) => d.addPage(x));
    }
    if (p.bookmarks) addOutline(d, marks);
    return [out("merged.pdf", await saved(d), `${d.getPageCount()} pages from ${files.length} files`)];
  },
  "split-pdf": async ([f], p, ctx) => {
    const { doc } = await open(f), n = doc.getPageCount(), base = stem(f.name); let groups: number[][] = [];
    if (p.mode === "ranges") { if (!p.ranges?.trim()) throw new Say("Enter the ranges to split, such as 1-3, 4-9."); groups = parseRanges(p.ranges, n); }
    if (p.mode === "single") groups = Array.from({ length: n }, (_, i) => [i]);
    if (p.mode === "every") for (let i = 0; i < n; i += p.n) groups.push(Array.from({ length: Math.min(p.n, n - i) }, (_, k) => i + k));
    if (p.mode === "size") {
      const max = p.maxMB * 1048576; let cur: number[] = [];
      for (let i = 0; i < n; i++) {
        ctx.progress(i / n, `Measuring page ${i + 1} of ${n}`);
        const next = [...cur, i];
        if (cur.length && (await (await copy(doc, next)).save()).length > max) { groups.push(cur); cur = [i]; } else cur = next;
      }
      if (cur.length) groups.push(cur);
    }
    const entries = []; let note = "", reused = false;
    for (let i = 0; i < groups.length; i++) {
      ctx.progress(i / groups.length, `Writing part ${i + 1} of ${groups.length}`);
      const g = groups[i], label = g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g[g.length - 1] + 1}`;
      const part = await finishRemoval(await copy(doc, g, true), p, ctx);
      if (part.note) note = part.note; reused ||= part.reused;
      entries.push({ name: `${base}-${label}.pdf`, bytes: part.bytes });
    }
    if (entries.length === 1) return [{ ...out(entries[0].name, entries[0].bytes, note.trim() || undefined), reused }];
    return [{ ...zipOut(`${base}-split.zip`, entries), note: `${entries.length} files.${note}`, reused }];
  },
  "organize-pdf": async (files, p, ctx) => {
    const docs = await Promise.all(files.map((f) => open(f).then((x) => x.doc))), d = await PDFDocument.create();
    const order = p.order ?? docs.flatMap((x, f) => x.getPageIndices().map((page) => ({ f, page, rot: 0 })));
    if (!order.length) throw new Say("Keep at least one page.");
    // Each file is copied in one pass, so links between its kept pages survive reordering.
    const copied = new Map<string, PDFPage>();
    for (let f = 0; f < docs.length; f++) {
      const wanted = [...new Set<number>(order.filter((o: any) => o.f === f).map((o: any) => o.page))];
      if (wanted.length) (await copyOnly(d, docs[f], wanted, true)).forEach((pg, k) => copied.set(`${f}:${wanted[k]}`, pg));
    }
    order.forEach((o: any, i: number) => {
      ctx.progress(i / order.length, "Arranging pages");
      const pg = copied.get(`${o.f}:${o.page}`);
      if (o.rot) pg.setRotation(degrees((pg.getRotation().angle + o.rot) % 360));
      d.addPage(pg);
    });
    const done = await finishRemoval(d, p, ctx);
    return [{ ...out(`${stem(files[0].name)}-organised.pdf`, done.bytes, `${order.length} pages.${done.note}`), reused: done.reused }];
  },
  "extract-pages": (files, p, ctx) => each(files, ctx, async (f) => {
    if (!p.pages?.trim()) throw new Say("Enter the pages to keep, such as 2-4, 9.");
    const { doc } = await open(f), idx = parseRanges(p.pages, doc.getPageCount()).flat();
    const done = await finishRemoval(await copy(doc, idx, true), p, ctx);
    return { ...out(`${stem(f.name)}-extract.pdf`, done.bytes, `${idx.length} pages.${done.note}`), reused: done.reused };
  }),
  "delete-pages": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc, bytes } = await open(f), n = doc.getPageCount(), drop = new Set(p.pages?.trim() ? parseRanges(p.pages, n).flat() : []), blanks: number[] = [];
    if (p.blank) for (let i = 0; i < n; i++) {
      if (drop.has(i)) continue;
      ctx.progress(i / n, `Checking page ${i + 1} of ${n}`);
      // Blank means no marked pixel at all, because one short line can be a signature.
      const d = toImg(await render(ctx, bytes, f.id, i, 100)).data; let marked = false;
      for (let k = 0; k < d.length && !marked; k += 4) marked = d[k] < 250 || d[k + 1] < 250 || d[k + 2] < 250;
      if (!marked) { drop.add(i); blanks.push(i + 1); }
    }
    if (!drop.size) throw new Say("Nothing to delete. Enter pages, or turn on blank page removal.");
    const keep = doc.getPageIndices().filter((i) => !drop.has(i));
    if (!keep.length) throw new Say("That would delete every page.");
    const done = await finishRemoval(await copy(doc, keep, true), p, ctx);
    return { ...out(`${stem(f.name)}-trimmed.pdf`, done.bytes, `Removed ${drop.size} page${drop.size === 1 ? "" : "s"}, ${keep.length} left.${blanks.length ? ` Blank: page${blanks.length === 1 ? "" : "s"} ${blanks.join(", ")}.` : ""}${done.note}`), reused: done.reused };
  }),
  "rotate-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc } = await open(f), pages = doc.getPages();
    for (const i of pagesIn(p.pages, pages.length)) pages[i].setRotation(degrees((pages[i].getRotation().angle + +p.angle) % 360));
    return out(`${stem(f.name)}-rotated.pdf`, await saved(doc));
  }),
  "resize-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc } = await open(f), d = await PDFDocument.create(), [a, b] = SIZES[p.size], m = p.margin;
    flattenAnnots(doc); // An embedded page drops its annotations, so filled-in values are baked in first.
    for (const src of doc.getPages()) {
      const v = visual(src), land = p.orient === "landscape" || (p.orient === "auto" && v.W > v.H), [W, H] = land ? [b, a] : [a, b];
      const k = Math.min((W - 2 * m) / v.W, (H - 2 * m) / v.H), pg = d.addPage([W, H]);
      await drawVisible(d, pg, src, (W - v.W * k) / 2, (H - v.H * k) / 2, k);
    }
    return out(`${stem(f.name)}-${p.size}.pdf`, await saved(d));
  }),
  "crop-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc, bytes } = await open(f), pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i], c = pg.getCropBox(), r = ((pg.getRotation().angle % 360) + 360) % 360; ctx.progress(i / pages.length, `Page ${i + 1} of ${pages.length}`);
      let [t, rt, bt, l] = [p.top, p.right, p.bottom, p.left]; // margins as the reader sees them
      if (p.mode === "auto") {
        const im = toImg(await render(ctx, bytes, f.id, i, 72)); let x0 = im.width, y0 = im.height, x1 = -1, y1 = -1;
        for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) { const q = (y * im.width + x) * 4; if (im.data[q] < 240 || im.data[q + 1] < 240 || im.data[q + 2] < 240) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
        if (x1 < 0) continue;
        const s = (r % 180 ? c.height : c.width) / im.width;
        [t, rt, bt, l] = [Math.max(0, y0 * s - p.pad), Math.max(0, (im.width - 1 - x1) * s - p.pad), Math.max(0, (im.height - 1 - y1) * s - p.pad), Math.max(0, x0 * s - p.pad)];
      }
      const [T, R, B, L] = r === 90 ? [l, t, rt, bt] : r === 180 ? [bt, l, t, rt] : r === 270 ? [rt, bt, l, t] : [t, rt, bt, l];
      const w = c.width - L - R, h = c.height - T - B;
      if (w < 10 || h < 10) throw new Say(`Those margins leave nothing of page ${i + 1}.`);
      pg.setCropBox(c.x + L, c.y + B, w, h); pg.setTrimBox(c.x + L, c.y + B, w, h);
    }
    return out(`${stem(f.name)}-cropped.pdf`, await saved(doc));
  }),
  "n-up-pdf": async ([f], p, ctx) => {
    const { doc } = await open(f), d = await PDFDocument.create(), n = +p.n, [cols, rows] = ({ 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3] } as Record<number, number[]>)[n];
    const src = doc.getPages(), landscape = n === 2 || n === 6, [a, b] = SIZES[p.size], [W, H] = landscape ? [b, a] : [a, b], m = 18, cw = (W - 2 * m - (cols - 1) * p.gap) / cols, ch = (H - 2 * m - (rows - 1) * p.gap) / rows;
    let sheet: PDFPage;
    flattenAnnots(doc);
    for (let i = 0; i < src.length; i++) {
      ctx.progress(i / src.length, `Page ${i + 1} of ${src.length}`);
      if (i % n === 0) sheet = d.addPage([W, H]);
      const q = i % n, cx = m + (q % cols) * (cw + p.gap), cy = H - m - ch - Math.floor(q / cols) * (ch + p.gap), v = visual(src[i]), k = Math.min(cw / v.W, ch / v.H), x = cx + (cw - v.W * k) / 2, y = cy + (ch - v.H * k) / 2;
      await drawVisible(d, sheet, src[i], x, y, k);
      if (p.border) sheet.drawRectangle({ x, y, width: v.W * k, height: v.H * k, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
    }
    return [out(`${stem(f.name)}-${n}up.pdf`, await saved(d), `${d.getPageCount()} sheets`)];
  },
  "booklet-pdf": async ([f], p, ctx) => {
    const { doc } = await open(f), d = await PDFDocument.create(), src = doc.getPages(), total = Math.ceil(src.length / 4) * 4, [a, b] = SIZES[p.size], W = b, H = a, cw = W / 2;
    flattenAnnots(doc);
    const place = async (sheet: PDFPage, idx: number, left: boolean) => {
      if (idx >= src.length) return;
      const v = visual(src[idx]), k = Math.min(cw / v.W, H / v.H);
      await drawVisible(d, sheet, src[idx], (left ? 0 : cw) + (cw - v.W * k) / 2, (H - v.H * k) / 2, k);
    };
    for (let i = 0; i < total / 2; i++) {
      ctx.progress(i / (total / 2), "Imposing pages");
      const sheet = d.addPage([W, H]);
      if (i % 2 === 0) { await place(sheet, total - 1 - i, true); await place(sheet, i, false); } else { await place(sheet, i, true); await place(sheet, total - 1 - i, false); }
    }
    return [out(`${stem(f.name)}-booklet.pdf`, await saved(d), `${total / 4} sheets. Print double-sided, flip on the short edge.`)];
  },

  "compress-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc, bytes } = await open(f), set = ({ balanced: [150, 72], small: [96, 58], print: [220, 84] } as Record<string, number[]>)[p.level];
    if (set) await shrinkImages(doc, set[0], set[1], ctx);
    ctx.progress(0.9, "Rewriting file structure");
    const rebuilt = set ? await doc.save({ useObjectStreams: true }) : bytes;
    const { bytes: small } = await qpdf(rebuilt, (i, o) => ["--object-streams=generate", "--compress-streams=y", "--recompress-flate", "--compression-level=9", i, o]);
    const best = small.length < f.size ? small : await bytesOf(f), pct = Math.round((1 - best.length / f.size) * 100);
    return out(`${stem(f.name)}-compressed.pdf`, best, best.length < f.size ? `${pct}% smaller` : "Already well compressed, so the original is kept.");
  }),
  "linearize-pdf": (files, p, ctx) => each(files, ctx, async (f) => { const { bytes } = await open(f); return out(`${stem(f.name)}-web.pdf`, (await qpdf(bytes, (i, o) => ["--linearize", i, o])).bytes); }),
  "repair-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const input = await bytesOf(f), { bytes, warned } = await qpdf(input, (i, o) => ["--object-streams=generate", i, o]).catch(async (e) => {
      // Some damage stops this qpdf build but not pdf-lib's more forgiving parser.
      if (e instanceof Say && /password/.test(e.message)) throw e;
      try { return { bytes: await (await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: false })).save(), warned: true }; }
      catch { throw new Say(`${f.name} is too damaged to repair.`); }
    });
    const pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount(), count = `${pages} page${pages === 1 ? "" : "s"}`;
    return out(`${stem(f.name)}-repaired.pdf`, bytes, warned ? `Rebuilt the file structure and recovered ${count}. Check that nothing is missing.` : `No damage found. ${count}.`);
  }),
  "grayscale-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc, bytes } = await open(f), d = await PDFDocument.create(), n = doc.getPageCount();
    for (let i = 0; i < n; i++) {
      ctx.progress(i / n, `Page ${i + 1} of ${n}`);
      const b = await render(ctx, bytes, f.id, i, p.dpi, true), v = visual(doc.getPage(i)), im = await d.embedJpg(await encode(toImg(b), "jpeg", 82)), pg = d.addPage([v.W, v.H]);
      pg.drawImage(im, { x: 0, y: 0, width: v.W, height: v.H });
    }
    return out(`${stem(f.name)}-gray.pdf`, await saved(d));
  }),
  "flatten-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc } = await open(f);
    refuseXfa(f);
    // flattenAnnots bakes in field appearances too, and it honours hidden fields, which form.flatten() does not.
    try { const form = doc.getForm(); if (form.getFields().length) form.updateFieldAppearances(); } catch { /* A broken form still has its annotations flattened below. */ }
    const kept = flattenAnnots(doc);
    return out(`${stem(f.name)}-flat.pdf`, await saved(doc, { updateFieldAppearances: false }), kept ? `${kept} annotation${kept === 1 ? " has" : "s have"} no stored appearance, so ${kept === 1 ? "it was" : "they were"} kept as ${kept === 1 ? "an annotation" : "annotations"}.` : undefined);
  }),

  "protect-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    if (!p.password) throw new Say("Enter a password to protect the file with.");
    const { bytes } = await open(f), rnd = crypto.getRandomValues(new Uint8Array(24)).reduce((s, x) => s + x.toString(16).padStart(2, "0"), "");
    // Without an owner password, anyone holding the open password could lift the restrictions.
    const owner = p.owner || rnd, limits = [...(p.noPrint ? ["--print=none"] : []), ...(p.noEdit ? ["--modify=none"] : []), ...(p.noCopy ? ["--extract=n"] : [])];
    return out(`${stem(f.name)}-protected.pdf`, (await qpdf(bytes, (i, o) => ["--encrypt", p.password, owner, "256", ...limits, "--", i, o])).bytes, "Encrypted with AES-256. Keep the password safe: it cannot be recovered.");
  }),
  "unlock-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    const input = await bytesOf(f);
    try { return out(`${stem(f.name)}-unlocked.pdf`, (await qpdf(input, (i, o) => [`--password=${p.password ?? ""}`, "--decrypt", i, o])).bytes); }
    catch (e) { if (e instanceof Say && /password/.test(e.message)) throw new Say(p.password ? "That password is not correct for this PDF." : "This PDF needs its password. Enter it to unlock the file."); throw e; }
  }),
  "redact-pdf": async ([f], p, ctx) => {
    const regions: any[] = p.regions ?? [];
    if (!regions.length) throw new Say("Draw at least one box over what you want removed.");
    const { doc, bytes } = await open(f), d = await PDFDocument.create(), n = doc.getPageCount();
    const everyPage = p.flattenAll !== false, tree = pageTree(doc), hidden = new Set(regions.flatMap((r) => [...pageStreams(doc, doc.getPage(r.page), tree, true)]));
    const untouched = everyPage ? [] : doc.getPageIndices().filter((i) => !regions.some((r) => r.page === i) && !sharesHidden(doc, doc.getPage(i), hidden, tree));
    const kept = new Map<number, PDFPage>();
    if (untouched.length) (await copyOnly(d, doc, untouched)).forEach((pg, k) => kept.set(untouched[k], pg));
    for (let i = 0; i < n; i++) {
      if (kept.has(i)) { d.addPage(kept.get(i)); continue; }
      const here = regions.filter((r) => r.page === i);
      ctx.progress(i / n, `Flattening page ${i + 1} of ${n}`);
      const b = await render(ctx, bytes, f.id, i, p.dpi), c = new OffscreenCanvas(b.width, b.height), g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(b, 0, 0); b.close(); g.fillStyle = "#000";
      for (const r of here) g.fillRect(Math.floor(r.x * c.width) - 1, Math.floor(r.y * c.height) - 1, Math.ceil(r.w * c.width) + 2, Math.ceil(r.h * c.height) + 2);
      const v = visual(doc.getPage(i)), im = await d.embedJpg(await encode(g.getImageData(0, 0, c.width, c.height), "jpeg", 90)), pg = d.addPage([v.W, v.H]), unit = numOf(doc.getPage(i).node, "UserUnit");
      pg.drawImage(im, { x: 0, y: 0, width: v.W, height: v.H });
      if (unit) pg.node.set(PDFName.of("UserUnit"), PDFNumber.of(unit));
    }
    const flat = n - kept.size;
    return [out(`${stem(f.name)}-redacted.pdf`, await saved(d), everyPage ? "Every page is now an image, so nothing hidden remains in the file. Run OCR PDF if you need searchable text." : `Flattened ${flat} of ${n} page${n === 1 ? "" : "s"}. The content under the boxes is gone from the file.`)];
  },
  "pdf-metadata": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc } = await open(f); let wiped = "";
    if (p.wipe) {
      const info = doc.context.trailerInfo.Info;
      if (info) { doc.context.delete(info as PDFRef); doc.context.trailerInfo.Info = undefined; }
      // XMP and application data can sit on any page, image or font, so every object is checked.
      const keys = ["Metadata", "PieceInfo"].map((k) => PDFName.of(k));
      for (const [ref, o] of doc.context.enumerateIndirectObjects()) {
        const d = o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : null;
        if (!d) continue;
        if (nameOf(d.lookup(PDFName.of("Type"))) === "Metadata") { doc.context.delete(ref); continue; }
        for (const k of keys) d.delete(k);
        // /T names the author on a comment. On a form widget it is the field's name, which the form needs.
        if (d.has(PDFName.of("Rect")) && nameOf(d.lookup(PDFName.of("Subtype"))) !== "Widget") d.delete(PDFName.of("T"));
        if (o instanceof PDFRawStream && nameOf(o.dict.lookup(PDFName.of("Filter"))) === "DCTDecode") { const clean = stripJpeg(o.contents); if (clean) doc.context.assign(ref, PDFRawStream.of(o.dict, clean)); }
      }
      collectGarbage(doc);
      const left = stillInside(doc);
      wiped = `Document properties, XMP and image metadata removed.${left.length ? ` Still in the file: ${left.join(", ")}. Use Redact PDF if these must go.` : ""}`;
    } else {
      // An old XMP packet would keep contradicting the new properties.
      doc.catalog.delete(PDFName.of("Metadata"));
      if (p.title) doc.setTitle(p.title); if (p.author) doc.setAuthor(p.author); if (p.subject) doc.setSubject(p.subject);
      if (p.keywords) doc.setKeywords(p.keywords.split(",").map((x: string) => x.trim()));
    }
    return out(`${stem(f.name)}-meta.pdf`, await saved(doc, { updateFieldAppearances: false }), wiped || "Properties updated.");
  }),

  "sign-pdf": async ([f], p, ctx) => {
    if (!p.placements?.length) throw new Say("Create a signature and place it on a page.");
    const { doc } = await open(f), pages = doc.getPages();
    for (const s of p.placements) {
      const pg = pages[s.page], v = visual(pg), im = await doc.embedPng(s.png);
      v.begin(); pg.drawImage(im, { x: s.x * v.W, y: v.H - (s.y + s.h) * v.H, width: s.w * v.W, height: s.h * v.H }); v.end();
    }
    return [out(`${stem(f.name)}-signed.pdf`, await saved(doc))];
  },
  "fill-pdf": async ([f], p) => {
    const { doc } = await open(f);
    refuseXfa(f);
    const form = doc.getForm();
    for (const fd of form.getFields()) {
      const v = p.values?.[fd.getName()];
      if (v === undefined) continue;
      if (fd instanceof PDFTextField) fd.setText(String(v));
      else if (fd instanceof PDFCheckBox) { if (v) fd.check(); else fd.uncheck(); }
      else if ((fd instanceof PDFDropdown || fd instanceof PDFRadioGroup || fd instanceof PDFOptionList) && v) fd.select(String(v));
    }
    if (p.flatten) { form.updateFieldAppearances(); flattenAnnots(doc); }
    return [out(`${stem(f.name)}-filled.pdf`, await saved(doc, p.flatten ? { updateFieldAppearances: false } : {}))];
  },
  "watermark-pdf": (files, p, ctx) => each(files, ctx, async (f) => {
    if (!p.text?.trim()) throw new Say("Enter the watermark text.");
    const { doc } = await open(f), font = await doc.embedFont(StandardFonts.HelveticaBold), pages = doc.getPages();
    for (const i of pagesIn(p.pages, pages.length)) {
      const pg = pages[i], v = visual(pg), w = textWidth(font, p.text, p.size), a = (p.rotate * Math.PI) / 180, cx = v.W / 2 - (Math.cos(a) * w) / 2 + (Math.sin(a) * p.size) / 3, cy = v.H / 2 - (Math.sin(a) * w) / 2 - (Math.cos(a) * p.size) / 3;
      v.begin(); await stamp(doc, pg, font, p.text, cx, cy, p.size, p.color, p.opacity / 100, p.rotate); v.end();
    }
    return out(`${stem(f.name)}-watermarked.pdf`, await saved(doc));
  }),
  "page-numbers": (files, p, ctx) => each(files, ctx, async (f) => {
    const { doc } = await open(f), font = await doc.embedFont(StandardFonts.Helvetica), pages = doc.getPages(), total = pages.length - p.skip + p.start - 1;
    for (let i = p.skip; i < pages.length; i++) {
      const pg = pages[i], v = visual(pg), m = p.margin, n = i - p.skip + p.start, label = (p.format || "{n}").replaceAll("{n}", String(n)).replaceAll("{total}", String(total));
      const at = (pos: string, t: string, size: number) => { const w = textWidth(font, t, size); return [pos.includes("l") ? m : pos.includes("r") ? v.W - m - w : (v.W - w) / 2, pos.startsWith("t") ? v.H - m - size : m]; };
      v.begin();
      const [x, y] = at(p.position, label, p.size); await stamp(doc, pg, font, label, x, y, p.size, "#333333");
      if (p.header && !p.position.startsWith("t")) { const [hx, hy] = at("tc", p.header, p.size); await stamp(doc, pg, font, p.header, hx, hy, p.size, "#333333"); }
      if (p.header && p.position.startsWith("t")) { const [hx] = at("tc", p.header, p.size); await stamp(doc, pg, font, p.header, hx, v.H - m - p.size * 2.6, p.size, "#333333"); }
      if (p.footer) { const [fx, fy] = at("bc", p.footer, p.size); await stamp(doc, pg, font, p.footer, fx, p.position.startsWith("b") ? fy + p.size * 1.6 : fy, p.size, "#333333"); }
      v.end();
    }
    return out(`${stem(f.name)}-numbered.pdf`, await saved(doc));
  }),

  "images-to-pdf": async (files, p, ctx) => {
    const d = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      ctx.progress(i / files.length, `Adding ${files[i].name}`);
      const f = files[i], b = await bytesOf(f), fmt = sniff(b); let im;
      let upright = fmt === "jpeg";
      if (upright) { const exifr = (await import("exifr/dist/full.esm.mjs")).default; const o = await exifr.orientation(b).catch(() => 1); upright = !o || o === 1; }
      if (upright) {
        const clean = stripJpeg(b), icc = jpegIcc(b);
        if (clean) try {
          im = await d.embedJpg(clean);
          // pdf-lib labels every JPEG DeviceRGB, which would show a wide-gamut photo with the wrong colours.
          if (icc && im.embedder?.colorSpace !== "DeviceCMYK" && String.fromCharCode(...icc.subarray(16, 20)) === "RGB ") { await im.embed(); (d.context.lookup(im.ref) as PDFStream).dict.set(PDFName.of("ColorSpace"), d.context.obj([PDFName.of("ICCBased"), d.context.register(d.context.flateStream(icc, { N: 3 }))])); }
        } catch { im = null; }
      }
      if (!im) {
        const img = await loadImage(f, { ...ctx, preview: false });
        let alpha = false; for (let k = 3; k < img.data.length; k += 4) if (img.data[k] < 255) { alpha = true; break; }
        // A PNG stays lossless. Other formats are already lossy, so a high-quality JPEG keeps the PDF a sensible size.
        im = alpha || fmt === "png" ? await d.embedPng(await encode(img, "png")) : await d.embedJpg(await encode(img, "jpeg", 92));
      }
      let W = im.width * 0.75 + 2 * p.margin, H = im.height * 0.75 + 2 * p.margin;
      if (p.size !== "fit") { const [a, b2] = SIZES[p.size], land = p.orient === "landscape" || (p.orient === "auto" && im.width > im.height); [W, H] = land ? [b2, a] : [a, b2]; }
      else if (p.orient === "landscape" && H > W || p.orient === "portrait" && W > H) [W, H] = [H, W];
      const k = Math.min((W - 2 * p.margin) / im.width, (H - 2 * p.margin) / im.height), w = im.width * k, h = im.height * k;
      d.addPage([W, H]).drawImage(im, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
    }
    return [out(files.length === 1 ? `${stem(files[0].name)}.pdf` : "images.pdf", await saved(d), `${files.length} page${files.length === 1 ? "" : "s"}`)];
  },
  "pdf-to-images": async ([f], p, ctx) => {
    const { doc, bytes } = await open(f), idx = pagesIn(p.pages, doc.getPageCount()), entries = [], base = stem(f.name);
    for (let k = 0; k < idx.length; k++) {
      ctx.progress(k / idx.length, `Page ${idx[k] + 1} (${k + 1} of ${idx.length})`);
      const img = toImg(await render(ctx, bytes, f.id, idx[k], p.dpi));
      entries.push({ name: `${base}-${String(idx[k] + 1).padStart(3, "0")}.${EXT[p.format]}`, bytes: await encode(img, p.format, p.quality) });
    }
    if (entries.length === 1) return [{ name: entries[0].name, type: MIME[p.format], bytes: entries[0].bytes }];
    return [{ ...zipOut(`${base}-images.zip`, entries), note: `${entries.length} images` }];
  },
  "pdf-to-text": async ([f], p, ctx) => {
    const { doc, bytes } = await open(f), n = doc.getPageCount(), parts: string[] = [];
    const pages: any[][] = [];
    for (let i = 0; i < n; i++) { ctx.progress(i / n, `Reading page ${i + 1} of ${n}`); pages.push(await ctx.main("text", { doc: new Blob([bytes as BlobPart]), key: f.id, page: i })); }
    const sizes = new Map<number, number>();
    for (const it of pages.flat()) { const h = Math.round(it.h * 2) / 2; sizes.set(h, (sizes.get(h) ?? 0) + it.str.length); }
    const body = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
    for (const it of pages) parts.push(textFromItems(it, p.as === "md", body));
    const text = parts.join(p.as === "md" ? "\n\n---\n\n" : "\n\n").trim();
    if (!text) throw new Say("This PDF has no text layer, so it is probably a scan. Run OCR PDF first.");
    return [{ name: `${stem(f.name)}.${p.as}`, type: p.as === "md" ? "text/markdown" : "text/plain", text, note: `${text.split(/\s+/).length.toLocaleString()} words` }];
  },
  "extract-images": async ([f], p, ctx) => {
    const { doc, bytes } = await open(f), n = doc.getPageCount(), entries = [];
    for (let i = 0; i < n; i++) {
      ctx.progress(i / n, `Page ${i + 1} of ${n}`);
      const list = await ctx.main<ImageBitmap[]>("images", { doc: new Blob([bytes as BlobPart]), key: f.id, page: i, minSize: p.minSize });
      for (let k = 0; k < list.length; k++) entries.push({ name: `page-${i + 1}-image-${k + 1}.png`, bytes: await encode(toImg(list[k]), "png") });
    }
    if (!entries.length) throw new Say("No images found at this size.");
    return [{ ...zipOut(`${stem(f.name)}-images.zip`, entries), note: `${entries.length} images` }];
  },
  "ocr-pdf": async ([f], p, ctx) => {
    const { doc, bytes } = await open(f), pages = doc.getPages(), font = await doc.embedFont(StandardFonts.Helvetica); let words = 0;
    for (let i = 0; i < pages.length; i++) {
      ctx.progress(i / pages.length, `Reading page ${i + 1} of ${pages.length}`);
      const b = await render(ctx, bytes, f.id, i, p.dpi), width = b.width, height = b.height;
      const r = await ctx.main<{ words: { text: string; x0: number; y0: number; x1: number; y1: number }[] }>("ocr", { bitmap: b, lang: p.lang }, [b]);
      const pg = pages[i], v = visual(pg), key = pg.node.newFontDictionary("OcrF", font.ref), sx = v.W / width, sy = v.H / height;
      v.begin();
      const ops: PDFOperator[] = [PDFOperator.of("BT" as any), PDFOperator.of("Tr" as any, [PDFNumber.of(3)])];
      for (const w of r.words) {
        const t = w.text.replace(/[^\x20-\x7e\xa0-\xff]/g, ""); if (!t.trim()) continue;
        const size = Math.max(1, (w.y1 - w.y0) * sy), wide = font.widthOfTextAtSize(t, size), target = (w.x1 - w.x0) * sx;
        ops.push(PDFOperator.of("Tf" as any, [key, PDFNumber.of(size)]), PDFOperator.of("Tz" as any, [PDFNumber.of(wide ? (target / wide) * 100 : 100)]), PDFOperator.of("Tm" as any, [1, 0, 0, 1, w.x0 * sx, v.H - w.y1 * sy].map((x) => PDFNumber.of(x))), PDFOperator.of("Tj" as any, [font.encodeText(t)]));
        words++;
      }
      ops.push(PDFOperator.of("ET" as any));
      pg.pushOperators(...ops);
      v.end();
    }
    return [out(`${stem(f.name)}-searchable.pdf`, await saved(doc), `Added ${words.toLocaleString()} searchable words.`)];
  },
  "markdown-to-pdf": async (files, p) => {
    const text = files[0] ? new TextDecoder().decode(await bytesOf(files[0])) : p.text;
    if (!text?.trim()) throw new Say("Write or drop in some Markdown first.");
    return [out(`${files[0] ? stem(files[0].name) : "document"}.pdf`, await markdownPdf(text, p))];
  },
  "compare-pdf": async (files, p, ctx) => {
    const [a, b] = await Promise.all([open(files[0]), open(files[1])]), n = Math.max(a.doc.getPageCount(), b.doc.getPageCount()), d = await PDFDocument.create(), [R, G, B] = [parseInt(p.color.slice(1, 3), 16), parseInt(p.color.slice(3, 5), 16), parseInt(p.color.slice(5, 7), 16)], changed: number[] = [];
    for (let i = 0; i < n; i++) {
      ctx.progress(i / n, `Comparing page ${i + 1} of ${n}`);
      if (i >= a.doc.getPageCount() || i >= b.doc.getPageCount()) { changed.push(i + 1); const from = i < a.doc.getPageCount() ? a.doc : b.doc, [pg] = await copyOnly(d, from, [i]); d.addPage(pg); continue; }
      const x = await render(ctx, a.bytes, files[0].id, i, p.dpi), y = await render(ctx, b.bytes, files[1].id, i, p.dpi), w = Math.max(x.width, y.width), h = Math.max(x.height, y.height);
      const paint = (s: ImageBitmap) => { const c = new OffscreenCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(s, 0, 0); return g.getImageData(0, 0, w, h); };
      const P = paint(x), Q = paint(y); let diff = 0;
      for (let k = 0; k < P.data.length; k += 4) {
        if (Math.abs(P.data[k] - Q.data[k]) + Math.abs(P.data[k + 1] - Q.data[k + 1]) + Math.abs(P.data[k + 2] - Q.data[k + 2]) > 12) { diff++; P.data[k] = R; P.data[k + 1] = G; P.data[k + 2] = B; }
        else { P.data[k] = 255 - (255 - P.data[k]) * 0.35; P.data[k + 1] = 255 - (255 - P.data[k + 1]) * 0.35; P.data[k + 2] = 255 - (255 - P.data[k + 2]) * 0.35; }
      }
      if (!diff) {
        // Text can differ without visibly moving a pixel at this resolution.
        const read = (o: { bytes: Uint8Array }, id: string) => ctx.main<string>("text", { doc: new Blob([o.bytes as BlobPart]), key: id, page: i });
        if (JSON.stringify(await read(a, files[0].id)) !== JSON.stringify(await read(b, files[1].id))) diff = 1;
      }
      if (diff) changed.push(i + 1);
      const s = 72 / p.dpi, im = await d.embedJpg(await encode(P, "jpeg", 85));
      d.addPage([w * s, h * s]).drawImage(im, { x: 0, y: 0, width: w * s, height: h * s });
    }
    return [out("comparison.pdf", await saved(d), changed.length ? `Differences on page${changed.length === 1 ? "" : "s"} ${changed.join(", ")}.` : `No differences found in the text or at ${p.dpi} dpi. Changes smaller than that would not show.`)];
  },
  "inspect-pdf": async ([f]) => {
    const raw = await bytesOf(f), head = new TextDecoder("latin1").decode(raw.subarray(0, 12)), encrypted = looksEncrypted(raw), lines: string[] = [`File: ${f.name} (${(f.size / 1048576).toFixed(2)} MB)`, `PDF version: ${head.match(/%PDF-([\d.]+)/)?.[1] ?? "unknown"}`, `Encrypted: ${encrypted ? "yes" : "no"}`];
    if (encrypted) { try { await open(f); } catch { lines.push("", "The rest of this file cannot be read without its password."); return [{ name: `${stem(f.name)}-report.txt`, type: "text/plain", text: lines.join("\n") }]; } }
    const { doc } = await open(f), sizes = new Map<string, number>();
    for (const pg of doc.getPages()) { const k = `${Math.round(pg.getWidth())} × ${Math.round(pg.getHeight())} pt`; sizes.set(k, (sizes.get(k) ?? 0) + 1); }
    lines.push(`Pages: ${doc.getPageCount()}`, `Page sizes: ${[...sizes].map(([k, v]) => `${k} (${v})`).join(", ")}`, "", "Properties");
    for (const [k, v] of [["Title", doc.getTitle()], ["Author", doc.getAuthor()], ["Subject", doc.getSubject()], ["Keywords", doc.getKeywords()], ["Creator", doc.getCreator()], ["Producer", doc.getProducer()], ["Created", doc.getCreationDate()?.toISOString()], ["Modified", doc.getModificationDate()?.toISOString()]]) if (v) lines.push(`  ${k}: ${v}`);
    const fonts = new Map<string, boolean>(); let images = 0, imageBytes = 0, js = 0, attachments = 0, links = 0, annots = 0;
    for (const [, o] of doc.context.enumerateIndirectObjects()) {
      const d = o instanceof PDFStream ? o.dict : o instanceof PDFDict ? o : null; if (!d) continue;
      const type = nameOf(d.lookup(PDFName.of("Type"))), sub = nameOf(d.lookup(PDFName.of("Subtype")));
      if (type === "Font" && d.has(PDFName.of("BaseFont"))) fonts.set(nameOf(d.lookup(PDFName.of("BaseFont"))).replace(/^[A-Z]{6}\+/, ""), d.has(PDFName.of("FontDescriptor")) || d.has(PDFName.of("DescendantFonts")));
      if (sub === "Image" && o instanceof PDFRawStream) { images++; imageBytes += o.contents.length; }
      if (nameOf(d.lookup(PDFName.of("S"))) === "JavaScript" || d.has(PDFName.of("JS"))) js++;
      if (type === "Filespec" || d.has(PDFName.of("EF"))) attachments++;
      if (type === "Annot" || d.has(PDFName.of("Rect"))) { annots++; if (sub === "Link") links++; }
    }
    let form = 0; try { form = doc.getForm().getFields().length; } catch { /* no usable form */ }
    lines.push("", "Contents", `  Images: ${images} (${(imageBytes / 1048576).toFixed(2)} MB, ${f.size ? Math.round((imageBytes / f.size) * 100) : 0}% of the file)`, `  Form fields: ${form}`, `  Annotations: ${annots} (${links} links)`, `  Attachments: ${attachments}`, `  JavaScript actions: ${js}`, "", `Fonts (${fonts.size})`);
    for (const [k, v] of fonts) lines.push(`  ${k}${v ? "" : " (not embedded)"}`);
    const warn = [...(js ? ["Contains JavaScript. Be careful opening it in a full PDF reader."] : []), ...(attachments ? ["Contains attached files. Check them before opening."] : [])];
    if (warn.length) lines.unshift(...warn.map((w) => `WARNING: ${w}`), "");
    return [{ name: `${stem(f.name)}-report.txt`, type: "text/plain", text: lines.join("\n"), note: warn[0] }];
  },
});

export async function pdfFields(f: In) {
  const { doc } = await open(f);
  refuseXfa(f);
  return doc.getForm().getFields().flatMap((x: any): { name: string; options: string[]; kind: string; value: unknown }[] => {
    const base = { name: x.getName(), options: x.getOptions?.() ?? [] };
    if (x instanceof PDFTextField) return [{ ...base, kind: "TextField", value: x.getText() ?? "" }];
    if (x instanceof PDFCheckBox) return [{ ...base, kind: "CheckBox", value: x.isChecked() }];
    if (x instanceof PDFDropdown || x instanceof PDFOptionList) return [{ ...base, kind: "Dropdown", value: x.getSelected()[0] ?? "" }];
    if (x instanceof PDFRadioGroup) return [{ ...base, kind: "RadioGroup", value: x.getSelected() ?? "" }];
    return [];
  });
}
