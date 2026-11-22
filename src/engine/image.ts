import { Say, bytesOf, eachFile as each, stem, zipOut, type Ctx, type In, type Out, type Run } from "./core";
import { EXT, MIME, encode, flatten, hasAlpha, ico, joined, lanczos, load, pngBytes, resolveFormat, save, sniff, stripJpeg, toData } from "./codecs";
import { LOOKS, shade } from "./gl";

const canvas = (w: number, h: number) => { const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); const g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; return { c, g }; };
const bmp = (img: ImageData) => createImageBitmap(img);
const dataOf = (c: OffscreenCanvas) => c.getContext("2d").getImageData(0, 0, c.width, c.height);
const edit = (fn: (img: ImageData, p: any, ctx: Ctx, f: In) => ImageData | Promise<ImageData>, suffix = ""): Run => (files, p, ctx) => each(files, ctx, async (f) => save(await fn(await load(f, ctx), p, ctx, f), f, p, ctx, suffix));

function anchor(pos: string, W: number, H: number, w: number, h: number, m: number) {
  const x = pos.includes("l") ? m : pos.includes("r") ? W - w - m : (W - w) / 2;
  const y = pos.startsWith("t") ? m : pos.startsWith("b") ? H - h - m : (H - h) / 2;
  return [x, y];
}

async function hide(img: ImageData, boxes: { x: number; y: number; w: number; h: number }[], style: string, strength: number) {
  const { c, g } = canvas(img.width, img.height), base = await bmp(img), unit = Math.max(img.width, img.height) / 1000;
  g.drawImage(base, 0, 0);
  for (const b of boxes) {
    const [x, y, w, h] = [Math.max(0, b.x), Math.max(0, b.y), Math.min(b.w, img.width - b.x), Math.min(b.h, img.height - b.y)];
    if (w < 1 || h < 1) continue;
    if (style === "block") { g.fillStyle = "#000"; g.fillRect(x, y, w, h); continue; }
    if (style === "pixelate") {
      const size = Math.max(3, (strength / 3) * unit), t = canvas(Math.max(1, w / size), Math.max(1, h / size));
      t.g.drawImage(base, x, y, w, h, 0, 0, t.c.width, t.c.height);
      g.imageSmoothingEnabled = false; g.drawImage(t.c, x, y, w, h); g.imageSmoothingEnabled = true;
      continue;
    }
    // Blur from a heavily reduced copy: nothing of the fine detail reaches the output.
    const k = Math.max(4, (strength / 4) * unit), t = canvas(Math.max(2, w / k), Math.max(2, h / k));
    t.g.drawImage(base, x, y, w, h, 0, 0, t.c.width, t.c.height);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.filter = `blur(${k * 0.7}px)`; g.drawImage(t.c, x - k, y - k, w + 2 * k, h + 2 * k); g.restore();
  }
  return dataOf(c);
}


/** Keeps only the chunks needed to draw the image, and stops at IEND. */
function stripPng(b: Uint8Array) {
  const allow = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "acTL", "fcTL", "fdAT"]);
  const parts: Uint8Array[] = [b.subarray(0, 8)], v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 8; i + 12 <= b.length;) {
    const len = v.getUint32(i), type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    if (i + 12 + len > b.length) return null;
    if (allow.has(type)) parts.push(b.subarray(i, i + 12 + len));
    if (type === "IEND") return joined(parts);
    i += 12 + len;
  }
  return null;
}

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));
const toLab = (r: number, g: number, b: number) => {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122 * R + 0.5363 * G + 0.0514 * B), m = Math.cbrt(0.2119 * R + 0.6807 * G + 0.1074 * B), s = Math.cbrt(0.0883 * R + 0.2817 * G + 0.63 * B);
  return [0.2105 * l + 0.7936 * m - 0.0041 * s, 1.9779 * l - 2.4286 * m + 0.4506 * s, 0.0259 * l + 0.7828 * m - 0.8087 * s];
};
const toRgb = ([L, a, b]: number[]) => {
  const l = (L + 0.3963 * a + 0.2158 * b) ** 3, m = (L - 0.1056 * a - 0.0639 * b) ** 3, s = (L - 0.0895 * a - 1.2915 * b) ** 3;
  return [gam(4.0767 * l - 3.3077 * m + 0.2310 * s), gam(-1.2684 * l + 2.6098 * m - 0.3413 * s), gam(-0.0042 * l - 0.7034 * m + 1.7076 * s)];
};
function palette(img: ImageData, k: number) {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 40000))), pts: number[][] = [];
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) { const i = (y * img.width + x) * 4; if (img.data[i + 3] > 128) pts.push(toLab(img.data[i], img.data[i + 1], img.data[i + 2])); }
  if (!pts.length) throw new Say("This image is fully transparent, so it has no colours to extract.");
  const d = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Deterministic farthest-point seeding: the same image always gives the same palette.
  const means = [pts[Math.floor(pts.length / 2)].slice()];
  while (means.length < k) { let best = 0, far = -1; for (let i = 0; i < pts.length; i += 3) { const m = Math.min(...means.map((c) => d(pts[i], c))); if (m > far) { far = m; best = i; } } means.push(pts[best].slice()); }
  let counts: number[] = [];
  for (let it = 0; it < 12; it++) {
    const sum = means.map(() => [0, 0, 0]); counts = means.map(() => 0);
    for (const p of pts) { let b = 0, m = Infinity; for (let j = 0; j < means.length; j++) { const v = d(p, means[j]); if (v < m) { m = v; b = j; } } sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2]; counts[b]++; }
    means.forEach((c, j) => { if (counts[j]) for (let q = 0; q < 3; q++) c[q] = sum[j][q] / counts[j]; });
  }
  return means.map((c, i) => ({ c, n: counts[i] })).filter((x) => x.n).sort((a, b) => b.n - a.n).map(({ c }) => "#" + toRgb(c).map((v) => v.toString(16).padStart(2, "0")).join(""));
}

/** Finds the crop window with the most visual detail. */
function bestCrop(img: ImageData, ratio: number) {
  const S = 96, k = S / Math.max(img.width, img.height), w = Math.max(2, Math.round(img.width * k)), h = Math.max(2, Math.round(img.height * k));
  const { c, g } = canvas(w, h); const t = new OffscreenCanvas(img.width, img.height); t.getContext("2d").putImageData(img, 0, 0); g.drawImage(t, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, I = new Float64Array((w + 1) * (h + 1)), L = (x: number, y: number) => 0.3 * d[(y * w + x) * 4] + 0.59 * d[(y * w + x) * 4 + 1] + 0.11 * d[(y * w + x) * 4 + 2];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const e = x + 1 < w && y + 1 < h ? Math.abs(L(x, y) - L(x + 1, y)) + Math.abs(L(x, y) - L(x, y + 1)) : 0; I[(y + 1) * (w + 1) + x + 1] = e + I[y * (w + 1) + x + 1] + I[(y + 1) * (w + 1) + x] - I[y * (w + 1) + x]; }
  let cw = w, ch = cw / ratio; if (ch > h) { ch = h; cw = ch * ratio; } cw = Math.max(1, Math.round(cw)); ch = Math.max(1, Math.round(ch));
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y <= h - ch; y++) for (let x = 0; x <= w - cw; x++) {
    const v = I[(y + ch) * (w + 1) + x + cw] - I[y * (w + 1) + x + cw] - I[(y + ch) * (w + 1) + x] + I[y * (w + 1) + x];
    const centred = v * (1 - 0.15 * (Math.abs(x + cw / 2 - w / 2) / w + Math.abs(y + ch / 2 - h / 2) / h));
    if (centred > best) { best = centred; bx = x; by = y; }
  }
  let W = img.width, H = W / ratio; if (H > img.height) { H = img.height; W = H * ratio; }
  return { x: Math.min(img.width - W, Math.max(0, (bx / w) * img.width)), y: Math.min(img.height - H, Math.max(0, (by / h) * img.height)), w: W, h: H };
}
async function cover(img: ImageData, W: number, H: number) {
  const b = bestCrop(img, W / H), src = await bmp(img), { c, g } = canvas(W, H);
  g.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, W, H);
  return dataOf(c);
}
const SOCIAL: Record<string, [string, number, number][]> = {
  ig: [["instagram-post", 1080, 1350], ["instagram-square", 1080, 1080], ["instagram-story", 1080, 1920]],
  yt: [["youtube-thumbnail", 1280, 720]],
  li: [["linkedin-post", 1200, 627], ["linkedin-banner", 1584, 396]],
  x: [["x-post", 1600, 900], ["x-header", 1500, 500]],
  fb: [["facebook-post", 1200, 630], ["facebook-cover", 851, 315]],
  og: [["share-card", 1200, 630]],
};

function roundRect(g: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.roundRect(x, y, w, h, r); }

const similarity = (a: ImageData, b: ImageData) => {
  // Mean SSIM over 8 px luminance blocks.
  const L = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2], C1 = 6.5025, C2 = 58.5225;
  let total = 0, n = 0;
  for (let y = 0; y + 8 <= a.height; y += 4) for (let x = 0; x + 8 <= a.width; x += 4) {
    let ma = 0, mb = 0, aa = 0, bb = 0, ab = 0;
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) { const i = ((y + v) * a.width + x + u) * 4, p = L(a.data, i), q = L(b.data, i); ma += p; mb += q; aa += p * p; bb += q * q; ab += p * q; }
    ma /= 64; mb /= 64; const va = aa / 64 - ma * ma, vb = bb / 64 - mb * mb, c = ab / 64 - ma * mb;
    total += ((2 * ma * mb + C1) * (2 * c + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return n ? total / n : 1;
};

/** Removes what can run or phone home when an SVG is opened elsewhere. */
const scrubSvg = {
  name: "lathe-scrub",
  fn: () => ({ element: { enter(node: any, parent: any) {
    const tag = node.name.split(":").pop().toLowerCase(), link = node.attributes.href ?? node.attributes["xlink:href"] ?? "";
    const animatesLink = ["animate", "set"].includes(tag) && /href$/i.test(node.attributes.attributeName ?? "");
    const remote = ["image", "use", "feimage"].includes(tag) && link && !link.startsWith("#") && !/^data:image\/(png|jpeg|gif|webp);/i.test(link);
    if (["script", "foreignobject", "iframe", "embed", "object"].includes(tag) || animatesLink || remote) { parent.children = parent.children.filter((c: unknown) => c !== node); return; }
    for (const [k, v] of Object.entries(node.attributes)) if (/^on/i.test(k) || /^\s*javascript:/i.test(String(v))) delete node.attributes[k];
  } } }),
};

export const imageTools: Record<string, Run> = {
  "compress-image": (files, p, ctx) => each(files, ctx, async (f) => {
    const img = await load(f, ctx), fmt = p.format === "auto" ? await resolveFormat(f, "auto") : p.format, name = `${stem(f.name)}-compressed.${EXT[fmt] ?? "png"}`;
    let bytes: Uint8Array, q = p.quality, note = "";
    if (p.mode === "size" && fmt !== "png") {
      const target = p.targetKB * 1024; let lo = 1, hi = 100, best: Uint8Array = null;
      for (let i = 0; i < 7 && lo <= hi; i++) {
        q = (lo + hi) >> 1; ctx.progress(i / 7, `Searching quality (${q}%)`);
        const b = await encode(img, fmt, q);
        if (b.length <= target) { best = b; lo = q + 1; } else hi = q - 1;
      }
      bytes = best ?? (await encode(img, fmt, 1));
      note = best ? "" : "Could not reach that size at this resolution. This is the smallest result. Resize the image to go lower.";
    } else {
      if (p.mode === "size") note = "PNG is lossless, so it has no size target. This is its smallest form.";
      bytes = await encode(img, fmt, q ?? 75);
      if (fmt === "png" && !ctx.preview) { const { default: opt } = await import("@jsquash/oxipng/optimise"); bytes = new Uint8Array(await opt(img, { level: 2 })); }
    }
    const src = sniff(await bytesOf(f.blob.slice(0, 1024)));
    if (!ctx.preview && src === fmt && bytes.length >= f.size && !note) { bytes = await bytesOf(f); note = "Already well compressed, so the original is kept."; }
    return { name, type: MIME[fmt], bytes, note, width: img.width, height: img.height };
  }),
  "convert-image": (files, p, ctx) => each(files, ctx, async (f) => {
    const img = await load(f, ctx);
    return { name: `${stem(f.name)}.${EXT[p.format]}`, type: MIME[p.format], bytes: await encode(img, p.format, p.quality, p.matte), width: img.width, height: img.height };
  }),
  "remove-metadata": (files, p, ctx) => each(files, ctx, async (f) => {
    const b = await bytesOf(f), fmt = sniff(b);
    const exifr = (await import("exifr/dist/full.esm.mjs")).default;
    const meta = await exifr.parse(b, { tiff: true, gps: true, xmp: true, iptc: true }).catch(() => null);
    const n = meta ? Object.keys(meta).length : 0;
    const note = n ? `Removed ${n} metadata field${n === 1 ? "" : "s"}${meta.latitude != null ? ", including GPS location" : ""}.` : fmt === "jpeg" || fmt === "png" ? "No metadata found." : "Saved without metadata.";
    const png = fmt === "png" ? stripPng(b) : null;
    if (png) return { name: `${stem(f.name)}-clean.png`, type: MIME.png, bytes: png, note };
    const jpg = fmt === "jpeg" && (!meta?.Orientation || meta.Orientation === 1 || meta.Orientation === "Horizontal (normal)") ? stripJpeg(b) : null;
    if (jpg) return { name: `${stem(f.name)}-clean.jpg`, type: MIME.jpeg, bytes: jpg, note: `${note} Pixels untouched.` };
    const out = await save(await load(f, { ...ctx, preview: false }), f, p, { ...ctx, preview: false }, "-clean");
    return { ...out, note };
  }),
  "view-metadata": async ([f]) => {
    const exifr = (await import("exifr/dist/full.esm.mjs")).default, b = await bytesOf(f);
    const m = await exifr.parse(b, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, jfif: true, ihdr: true, mergeOutput: true }).catch(() => null);
    const fmtVal = (v: unknown) => v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? `${v.length} bytes` : Array.isArray(v) ? v.join(", ") : typeof v === "object" && v ? JSON.stringify(v) : String(v);
    const lines = m ? Object.entries(m).map(([k, v]) => `${k}: ${fmtVal(v)}`) : [];
    const gps = m?.latitude != null ? `This photo records where it was taken: ${m.latitude.toFixed(5)}, ${m.longitude.toFixed(5)}.` : "";
    return [{ name: `${stem(f.name)}-metadata.txt`, type: "text/plain", text: lines.length ? lines.join("\n") : "This file carries no metadata.", note: gps }];
  },
  "blur-faces": (files, p, ctx) => each(files, ctx, async (f) => {
    const img = await load(f, ctx), input = await bmp(img);
    const boxes = await ctx.main<{ x: number; y: number; w: number; h: number }[]>("faces", { bitmap: input, confidence: p.confidence / 100 }, [input]);
    const grown = boxes.map((b) => ({ x: b.x - b.w * 0.12, y: b.y - b.h * 0.22, w: b.w * 1.24, h: b.h * 1.38 }));
    const out = await save(await hide(img, grown, p.style, p.strength), f, p, ctx, "-faces");
    return { ...out, note: boxes.length ? `Hid ${boxes.length} face${boxes.length === 1 ? "" : "s"}. Check the result before sharing.` : "No faces found. Check the photo yourself before sharing it, or try a lower detection confidence." };
  }),
  "censor-image": edit(async (img, p, ctx) => { if (!p.regions?.length && !ctx.preview) throw new Say("Mark at least one box over what you want to hide."); return hide(img, (p.regions ?? []).map((r: any) => ({ x: r.x * img.width, y: r.y * img.height, w: r.w * img.width, h: r.h * img.height })), p.style, p.strength); }, "-hidden"),

  "resize-image": edit(async (img, p, ctx) => {
    const W = img.width, H = img.height, full = ctx.preview ? 1 : 1;
    let w = p.width * full, h = p.height * full;
    if (p.mode === "percent") { w = (W * p.percent) / 100; h = (H * p.percent) / 100; }
    if (p.mode === "fit") { const k = Math.min(p.width / W, p.height / H); w = W * k; h = H * k; }
    if (p.noEnlarge && p.mode !== "exact" && (w > W || h > H)) { const k = Math.min(W / w, H / h); w *= k; h *= k; }
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w * h > 120e6) throw new Say("That output is over 120 megapixels, more than a browser tab can safely hold.");
    if (p.mode === "fill") { const b = bestCrop(img, w / h), t = canvas(b.w, b.h); t.g.drawImage(await bmp(img), b.x, b.y, b.w, b.h, 0, 0, t.c.width, t.c.height); return lanczos(dataOf(t.c), w, h); }
    return lanczos(img, w, h);
  }, "-resized"),
  "crop-image": edit(async (img, p) => {
    const r = p.crop ?? { x: 0, y: 0, w: 1, h: 1 }, x = Math.round(r.x * img.width), y = Math.round(r.y * img.height), w = Math.max(1, Math.round(r.w * img.width)), h = Math.max(1, Math.round(r.h * img.height));
    const t = canvas(w, h); t.g.drawImage(await bmp(img), -x, -y); return dataOf(t.c);
  }, "-cropped"),
  "rotate-image": edit(async (img, p) => {
    const turn = +p.turn, rad = ((turn + p.angle) * Math.PI) / 180, W = img.width, H = img.height, co = Math.abs(Math.cos(rad)), si = Math.abs(Math.sin(rad));
    let w = W * co + H * si, h = W * si + H * co;
    if (p.autocrop && p.angle) {
      // Largest axis-aligned rectangle inside the rotated image.
      const [a, b] = turn % 180 ? [H, W] : [W, H], long = Math.max(a, b), short = Math.min(a, b), t = Math.abs(((p.angle * Math.PI) / 180)), s = Math.sin(t), c = Math.cos(t);
      if (short <= 2 * s * c * long) { const x = short / 2; [w, h] = a >= b ? [x / s, x / c] : [x / c, x / s]; }
      else { const d = c * c - s * s; [w, h] = [(a * c - b * s) / d, (b * c - a * s) / d]; }
    }
    const t = canvas(w, h), src = await bmp(img);
    t.g.translate(t.c.width / 2, t.c.height / 2); t.g.rotate(rad); t.g.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1); t.g.drawImage(src, -W / 2, -H / 2);
    return dataOf(t.c);
  }, "-rotated"),
  "adjust-image": edit((img, p) => shade(img, p), "-edited"),
  "filter-image": edit((img, p) => { const a = p.amount / 100, look = LOOKS[p.look], v: Record<string, number> = {}; for (const k in look) v[k] = look[k] * a; return shade(img, v); }, "-look"),
  "color-blindness": edit((img, p) => shade(img, {}, p.type), "-simulated"),
  "watermark-image": edit(async (img, p) => {
    const { c, g } = canvas(img.width, img.height), base = Math.min(img.width, img.height), size = (base * p.size) / 100;
    g.drawImage(await bmp(img), 0, 0);
    g.font = `600 ${size}px -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`; g.fillStyle = p.color; g.globalAlpha = p.opacity / 100; g.textBaseline = "middle"; g.textAlign = "center";
    const tw = g.measureText(p.text).width, rad = (p.rotate * Math.PI) / 180;
    if (p.layout === "tile") {
      const dx = tw + size * 3, dy = size * 4.5, R = Math.hypot(img.width, img.height);
      g.translate(img.width / 2, img.height / 2); g.rotate(rad);
      for (let y = -R, row = 0; y < R; y += dy, row++) for (let x = -R + (row % 2) * dx * 0.5; x < R; x += dx) g.fillText(p.text, x, y);
    } else {
      const [x, y] = anchor(p.layout, img.width, img.height, tw, size, size);
      g.translate(x + tw / 2, y + size / 2); g.rotate(rad); g.fillText(p.text, 0, 0);
    }
    return dataOf(c);
  }, "-watermarked"),
  "frame-image": async (files, p, ctx) => each(files, ctx, async (f) => {
    const img = await load(f, ctx), unit = Math.max(img.width, img.height), pad = (unit * p.padding) / 100, radius = (Math.min(img.width, img.height) * p.radius) / 100;
    const { c, g } = canvas(img.width + 2 * pad, img.height + 2 * pad);
    if (p.bg !== "none") { if (p.bg === "gradient") { const lg = g.createLinearGradient(0, 0, c.width, c.height); lg.addColorStop(0, p.color); lg.addColorStop(1, p.color2); g.fillStyle = lg; } else g.fillStyle = p.color; g.fillRect(0, 0, c.width, c.height); }
    if (p.shadow) { g.save(); g.shadowColor = `rgba(20,16,10,${0.5 * (p.shadow / 100)})`; g.shadowBlur = (unit * p.shadow) / 1800; g.shadowOffsetY = (unit * p.shadow) / 4500; g.fillStyle = "#000"; roundRect(g, pad, pad, img.width, img.height, radius); g.fill(); g.restore(); }
    g.save(); roundRect(g, pad, pad, img.width, img.height, radius); g.clip(); g.drawImage(await bmp(img), pad, pad); g.restore();
    return save(dataOf(c), f, { ...p, format: "png" }, ctx, "-framed");
  }),
  "social-resize": async ([f], p, ctx) => {
    const img = await load(f, ctx), wanted = Object.keys(SOCIAL).filter((k) => p[k]).flatMap((k) => SOCIAL[k]);
    if (!wanted.length) throw new Say("Pick at least one platform.");
    const entries = [];
    for (let i = 0; i < wanted.length; i++) {
      const [n, w, h] = wanted[i]; ctx.progress(i / wanted.length, n);
      entries.push({ name: `${n}-${w}x${h}.${EXT[p.format]}`, bytes: await encode(await cover(img, w, h), p.format, 88) });
    }
    return [zipOut(`${stem(f.name)}-social.zip`, entries)];
  },

  "remove-background": (files, p, ctx) => each(files, ctx, async (f) => {
    const img = await load(f, ctx), { matte } = await import("./ai");
    let a = await matte(img, ctx);
    if (p.feather > 0) {
      const t = canvas(img.width, img.height), m = new ImageData(img.width, img.height);
      for (let i = 0; i < a.length; i++) { m.data[i * 4 + 3] = a[i]; }
      const u = canvas(img.width, img.height); u.g.putImageData(m, 0, 0); t.g.filter = `blur(${p.feather}px)`; t.g.drawImage(u.c, 0, 0);
      const d = t.g.getImageData(0, 0, img.width, img.height).data; a = a.map((_, i) => d[i * 4 + 3]);
    }
    const cut = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    for (let i = 0; i < a.length; i++) cut.data[i * 4 + 3] = (cut.data[i * 4 + 3] * a[i]) / 255;
    if (p.bg === "none") return save(cut, f, { format: "png" }, ctx, "-cutout");
    const { c, g } = canvas(img.width, img.height);
    if (p.bg === "color") { g.fillStyle = p.color; g.fillRect(0, 0, c.width, c.height); } else { g.filter = `blur(${Math.max(img.width, img.height) / 60}px)`; g.drawImage(await bmp(img), 0, 0); g.filter = "none"; }
    g.drawImage(await bmp(cut), 0, 0);
    return save(dataOf(c), f, { format: "png" }, ctx, "-background");
  }),
  "upscale-image": async ([f], p, ctx) => {
    const img = await load(f, ctx);
    if (img.width * img.height > 4e6) throw new Say("Upscaling works on images up to 4 megapixels, to stay inside browser memory. Resize first.");
    const { upscale } = await import("./ai");
    return [await save(await upscale(img, ctx), f, p, ctx, "-2x")];
  },
  "ocr-image": (files, p, ctx) => each(files, ctx, async (f) => {
    const img = await load(f, ctx), input = await bmp(img);
    const r = await ctx.main<{ text: string; words: unknown[] }>("ocr", { bitmap: input, lang: p.lang }, [input]);
    return { name: `${stem(f.name)}.txt`, type: "text/plain", text: r.text.trim() || "No text found." };
  }),

  "favicon-generator": async ([f], p, ctx) => {
    const img = await load(f, ctx), src = await bmp(img);
    const draw = (s: number, opaque = false) => {
      const { c, g } = canvas(s, s), pad = (s * p.padding) / 100, inner = s - 2 * pad, k = Math.min(inner / img.width, inner / img.height), w = img.width * k, h = img.height * k;
      if (p.radius) { roundRect(g, 0, 0, s, s, (s * p.radius) / 100); g.clip(); }
      if (!p.transparent || opaque) { g.fillStyle = p.bg; g.fillRect(0, 0, s, s); }
      g.drawImage(src, (s - w) / 2, (s - h) / 2, w, h);
      return dataOf(c);
    };
    const entries: { name: string; bytes: Uint8Array }[] = [], icoParts = [];
    for (const s of [16, 32, 48]) { const b = await pngBytes(draw(s)); icoParts.push({ w: s, h: s, bytes: b }); }
    entries.push({ name: "favicon.ico", bytes: ico(icoParts) });
    for (const [n, s, o] of [["favicon-16x16.png", 16], ["favicon-32x32.png", 32], ["apple-touch-icon.png", 180, true], ["icon-192.png", 192], ["icon-512.png", 512]] as [string, number, boolean?][]) entries.push({ name: n, bytes: await pngBytes(draw(s, o)) });
    const enc = new TextEncoder();
    entries.push({ name: "site.webmanifest", bytes: enc.encode(JSON.stringify({ icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }] }, null, 2)) });
    const html = `<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">`;
    entries.push({ name: "paste-in-head.html", bytes: enc.encode(html + "\n") });
    return [{ ...zipOut("favicons.zip", entries), note: "Includes the HTML to paste into your page's head." }];
  },
  "color-palette": async ([f], p, ctx) => {
    const c = palette(await load(f, ctx), p.count);
    return [{ name: `${stem(f.name)}-palette.css`, type: "text/css", swatches: c, text: `:root {\n${c.map((x, i) => `  --color-${i + 1}: ${x};`).join("\n")}\n}\n` }];
  },
  "vectorize-image": async ([f], p, ctx) => {
    const mod: any = await import("imagetracerjs"), T = mod.default ?? mod;
    let img = await load(f, ctx);
    const k = 1600 / Math.max(img.width, img.height); if (k < 1) img = lanczos(img, Math.round(img.width * k), Math.round(img.height * k));
    const t = 11 - p.detail;
    const svg: string = T.imagedataToSVG(img, { numberofcolors: p.colors, ltres: t / 4, qtres: t / 4, pathomit: t * 1.6, blurradius: p.smooth, blurdelta: 20, roundcoords: 1, colorsampling: 2, colorquantcycles: 3, strokewidth: 0, viewbox: true });
    return [{ name: `${stem(f.name)}.svg`, type: "image/svg+xml", bytes: new TextEncoder().encode(svg), note: `${(svg.match(/<path/g) ?? []).length} paths` }];
  },
  "optimize-svg": (files, p, ctx) => each(files, ctx, async (f) => {
    const { optimize } = await import("svgo/browser"), src = new TextDecoder().decode(await bytesOf(f));
    if (!/<svg[\s>]/i.test(src)) throw new Say(`${f.name} is not an SVG file.`);
    const data = optimize(src, { multipass: p.multipass, floatPrecision: p.precision, plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } as any } } as any, ...(p.keepViewBox ? [] : [{ name: "removeViewBox" } as any]), { name: "removeScripts" } as any, scrubSvg as any] }).data;
    return { name: `${stem(f.name)}.min.svg`, type: "image/svg+xml", bytes: new TextEncoder().encode(data) };
  }),
  "image-to-base64": (files, p, ctx) => each(files, ctx, async (f) => {
    const b = await bytesOf(f), fmt = sniff(b), mime = fmt === "svg" ? "image/svg+xml" : MIME[fmt] ?? f.type; let s = "";
    for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
    const raw = btoa(s), uri = `data:${mime};base64,${raw}`;
    return { name: `${stem(f.name)}.txt`, type: "text/plain", text: p.as === "raw" ? raw : p.as === "css" ? `background-image: url("${uri}");` : p.as === "html" ? `<img src="${uri}" alt="">` : uri };
  }),
  "make-gif": async (files, p, ctx) => {
    const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
    const frames: Uint8ClampedArray[] = []; let W = 0, H = 0;
    for (let i = 0; i < files.length; i++) {
      ctx.progress((i / files.length) * 0.3, "Reading frames");
      const img = await load(files[i], ctx);
      if (!i) { W = Math.min(p.width, img.width); H = Math.max(1, Math.round((img.height * W) / img.width)); }
      const { c, g } = canvas(W, H), k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(await bmp(img), (W - w) / 2, (H - h) / 2, w, h);
      frames.push(g.getImageData(0, 0, c.width, c.height).data);
    }
    const order = p.boomerang && frames.length > 2 ? [...frames, ...frames.slice(1, -1).reverse()] : frames;
    // One palette for all frames, sampled across them, stops colours flickering.
    const sample = new Uint8ClampedArray(frames.reduce((a, x) => a + Math.ceil(x.length / 4 / 8) * 4, 0));
    let at = 0; for (const x of frames) for (let i = 0; i < x.length; i += 32) { sample.set(x.subarray(i, i + 4), at); at += 4; }
    const pal = quantize(new Uint8Array(sample.buffer), p.colors), gif = GIFEncoder();
    order.forEach((x, i) => {
      ctx.progress(0.3 + (i / order.length) * 0.7, `Encoding frame ${i + 1} of ${order.length}`);
      gif.writeFrame(applyPalette(new Uint8Array(x.buffer), pal), W, H, { palette: i ? undefined : pal, delay: p.delay, repeat: p.loop ? 0 : -1 });
    });
    gif.finish();
    return [{ name: "animation.gif", type: "image/gif", bytes: gif.bytes(), width: W, height: H, note: `${order.length} frames` }];
  },
  "gif-to-frames": async ([f], p, ctx) => {
    if (typeof ImageDecoder === "undefined") throw new Say("This browser has no ImageDecoder. Chrome, Edge and Safari can read animation frames.");
    const b = await bytesOf(f), fmt = sniff(b), dec = new ImageDecoder({ data: b, type: MIME[fmt] ?? f.type });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack.frameCount, entries = [];
    if (n < 2) throw new Say("This file has only one frame, so there is nothing to split.");
    for (let i = 0; i < n; i++) {
      ctx.progress(i / n, `Frame ${i + 1} of ${n}`);
      const { image } = await dec.decode({ frameIndex: i }), c = new OffscreenCanvas(image.displayWidth, image.displayHeight), g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(image, 0, 0); image.close();
      entries.push({ name: `frame-${String(i + 1).padStart(4, "0")}.${EXT[p.format]}`, bytes: await encode(g.getImageData(0, 0, c.width, c.height), p.format, 90) });
    }
    dec.close();
    return [{ ...zipOut(`${stem(f.name)}-frames.zip`, entries), note: `${n} frames` }];
  },
  collage: async (files, p, ctx) => {
    const imgs = await Promise.all(files.map(async (f) => bmp(await load(f, ctx))));
    const W = ctx.preview ? Math.min(p.width, 1400) : p.width, scale = W / p.width, gap = p.gap * scale, r = p.radius * scale, cells: { i: number; x: number; y: number; w: number; h: number }[] = [];
    let H = 0;
    if (p.layout === "justified") {
      const target = (W / Math.ceil(Math.sqrt(imgs.length))) * 0.8; let row: number[] = [], sum = 0, y = 0;
      const flush = (last: boolean) => {
        const avail = W - gap * (row.length - 1), h = last ? Math.min(avail / sum, target * 1.3) : avail / sum; let x = 0;
        for (const i of row) { const w = (imgs[i].width / imgs[i].height) * h; cells.push({ i, x, y, w, h }); x += w + gap; }
        y += h + gap; row = []; sum = 0;
      };
      imgs.forEach((m, i) => { row.push(i); sum += m.width / m.height; if (sum * target >= W) flush(false); });
      if (row.length) flush(true);
      H = y - gap;
    } else if (p.layout === "grid") {
      const cols = Math.ceil(Math.sqrt(imgs.length)), rows = Math.ceil(imgs.length / cols), s = (W - gap * (cols - 1)) / cols;
      imgs.forEach((_, i) => cells.push({ i, x: (i % cols) * (s + gap), y: Math.floor(i / cols) * (s + gap), w: s, h: s }));
      H = rows * s + (rows - 1) * gap;
    } else if (p.layout === "strip") {
      const sum = imgs.reduce((a, m) => a + m.width / m.height, 0), h = (W - gap * (imgs.length - 1)) / sum; let x = 0;
      imgs.forEach((m, i) => { const w = (m.width / m.height) * h; cells.push({ i, x, y: 0, w, h }); x += w + gap; });
      H = h;
    } else {
      let y = 0;
      imgs.forEach((m, i) => { const h = (m.height / m.width) * W; cells.push({ i, x: 0, y, w: W, h }); y += h + gap; });
      H = y - gap;
    }
    if (H > 16000) throw new Say("That layout is too tall for a browser canvas. Lower the width or use a grid.");
    const { c, g } = canvas(W, H); g.fillStyle = p.bg; g.fillRect(0, 0, c.width, c.height);
    for (const b of cells) {
      const m = imgs[b.i], k = Math.max(b.w / m.width, b.h / m.height), sw = b.w / k, sh = b.h / k;
      g.save(); roundRect(g, b.x, b.y, b.w, b.h, r); g.clip(); g.drawImage(m, (m.width - sw) / 2, (m.height - sh) / 2, sw, sh, b.x, b.y, b.w, b.h); g.restore();
    }
    return [await save(dataOf(c), { ...files[0], name: "collage.png" }, { format: "png" }, ctx)];
  },
  "split-image": async ([f], p, ctx) => {
    const img = await load(f, ctx), src = await bmp(img), entries = [], total = p.cols * p.rows;
    for (let r = 0; r < p.rows; r++) for (let q = 0; q < p.cols; q++) {
      const x = Math.round((q * img.width) / p.cols), y = Math.round((r * img.height) / p.rows), w = Math.round(((q + 1) * img.width) / p.cols) - x, h = Math.round(((r + 1) * img.height) / p.rows) - y, t = canvas(w, h);
      t.g.drawImage(src, -x, -y); ctx.progress((r * p.cols + q) / total, `Tile ${r * p.cols + q + 1} of ${total}`);
      entries.push({ name: `${stem(f.name)}-${String(r * p.cols + q + 1).padStart(2, "0")}.${EXT[p.format]}`, bytes: await encode(dataOf(t.c), p.format, 90) });
    }
    return [zipOut(`${stem(f.name)}-tiles.zip`, entries)];
  },
  "sprite-sheet": async (files, p, ctx) => {
    const imgs = await Promise.all(files.map(async (f) => bmp(await load(f, ctx)))), cw = Math.max(...imgs.map((m) => m.width)) + p.padding, ch = Math.max(...imgs.map((m) => m.height)) + p.padding, cols = Math.min(p.cols, imgs.length), rows = Math.ceil(imgs.length / cols);
    const { c, g } = canvas(cols * cw + p.padding, rows * ch + p.padding), frames: Record<string, unknown> = {}; let css = `.sprite { background-image: url("sprites.png"); background-repeat: no-repeat; display: inline-block; }\n`;
    imgs.forEach((m, i) => {
      const x = p.padding + (i % cols) * cw, y = p.padding + Math.floor(i / cols) * ch, n = stem(files[i].name).replace(/[^\w-]+/g, "-");
      g.drawImage(m, x, y); frames[n] = { x, y, w: m.width, h: m.height };
      css += `.sprite-${n} { width: ${m.width}px; height: ${m.height}px; background-position: -${x}px -${y}px; }\n`;
    });
    const e = new TextEncoder();
    return [zipOut("sprites.zip", [{ name: "sprites.png", bytes: await pngBytes(dataOf(c)) }, { name: "sprites.css", bytes: e.encode(css) }, { name: "sprites.json", bytes: e.encode(JSON.stringify({ frames }, null, 2)) }])];
  },
  "compare-images": async (files, p, ctx) => {
    const a = await load(files[0], ctx); let b = await load(files[1], ctx);
    if (a.width !== b.width || a.height !== b.height) b = lanczos(b, a.width, a.height);
    const out = new ImageData(new Uint8ClampedArray(a.data), a.width, a.height), n = parseInt(p.color.slice(1), 16), [R, G, B] = [n >> 16, (n >> 8) & 255, n & 255]; let diff = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const dd = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]));
      if (dd > p.threshold) { diff++; out.data[i] = R; out.data[i + 1] = G; out.data[i + 2] = B; out.data[i + 3] = 255; }
      else { const l = 0.3 * a.data[i] + 0.59 * a.data[i + 1] + 0.11 * a.data[i + 2]; out.data[i] = out.data[i + 1] = out.data[i + 2] = 200 + l * 0.2; }
    }
    const res = await save(out, { ...files[0], name: "difference.png" }, { format: "png" }, ctx);
    return [{ ...res, note: `${((diff / (a.width * a.height)) * 100).toFixed(2)}% of pixels differ. Structural similarity ${similarity(a, b).toFixed(4)}.` }];
  },
};
export { flatten, hasAlpha, toData };
