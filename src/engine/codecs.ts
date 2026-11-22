import { Say, bytesOf, stem, type Ctx, type In, type Out } from "./core";

export type Fmt = "jpeg" | "png" | "webp" | "avif" | "jxl" | "heic" | "gif" | "tiff" | "bmp" | "ico" | "svg" | "pdf" | "unknown";
export const EXT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif", jxl: "jxl", heic: "heic", gif: "gif", tiff: "tif", bmp: "bmp", ico: "ico" };
export const MIME: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", jxl: "image/jxl", heic: "image/heic", gif: "image/gif", tiff: "image/tiff", bmp: "image/bmp", ico: "image/x-icon" };

export function sniff(b: Uint8Array): Fmt {
  const at = (s: string, o = 0) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && at("PNG", 1)) return "png";
  if (at("GIF8")) return "gif";
  if (at("RIFF") && at("WEBP", 8)) return "webp";
  if (at("BM")) return "bmp";
  if (at("%PDF")) return "pdf";
  if (at("II*\0") || at("MM\0*")) return "tiff";
  if ((b[0] === 0xff && b[1] === 0x0a) || at("JXL ", 4)) return "jxl";
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return "ico";
  if (at("ftyp", 4)) {
    const brands = String.fromCharCode(...b.subarray(8, Math.min(48, b.length)));
    if (/avif|avis/.test(brands)) return "avif";
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brands)) return "heic";
  }
  const head = new TextDecoder().decode(b.subarray(0, 1024)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || head.includes("<svg")) return "svg";
  return "unknown";
}

export function toData(src: ImageBitmap | OffscreenCanvas, w = src.width, h = src.height) {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

let heif: Promise<any>;
async function decodeHeic(b: Uint8Array): Promise<ImageData> {
  heif ??= import("libheif-js/libheif-wasm/libheif-bundle.mjs").then((m: any) => m.default());
  const lib = await heif;
  const dec = new lib.HeifDecoder();
  const imgs = dec.decode(b);
  if (!imgs?.length) throw new Say("This HEIC file could not be read. It may be damaged.");
  const im = imgs[0], w = im.get_width(), h = im.get_height();
  const out = new ImageData(w, h);
  await new Promise<void>((res, rej) => im.display(out, (d: unknown) => (d ? res() : rej(new Say("This HEIC file could not be decoded.")))));
  imgs.forEach((x: any) => x.free?.());
  return out;
}

async function decodeBytes(b: Uint8Array, type: string, ctx: Ctx): Promise<ImageData> {
  const fmt = sniff(b);
  if (fmt === "heic") return decodeHeic(b);
  if (fmt === "jxl") return (await import("@jsquash/jxl/decode")).default(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  if (fmt === "svg") return toData(await ctx.main<ImageBitmap>("rasterSvg", { text: new TextDecoder().decode(b) }));
  if (fmt === "tiff") {
    const UTIF = (await import("utif2")).default;
    const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const ifds = UTIF.decode(buf as ArrayBuffer);
    UTIF.decodeImage(buf as ArrayBuffer, ifds[0]);
    return new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(ifds[0])), ifds[0].width, ifds[0].height);
  }
  if (fmt === "pdf") throw new Say("That is a PDF. Try the PDF to images tool.");
  try {
    return toData(await createImageBitmap(new Blob([b as BlobPart], { type: MIME[fmt] ?? type })));
  } catch {
    if (fmt === "avif") return (await import("@jsquash/avif/decode")).default(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    throw new Say("This file could not be read as an image. It may be damaged or in an unsupported format.");
  }
}

// Sliders re-run a tool constantly, so the last few decodes are kept.
const cache = new Map<string, ImageData>();
export async function load(f: In, ctx: Ctx): Promise<ImageData> {
  const key = `${f.id}:${ctx.preview ? "p" : "f"}`;
  if (cache.has(key)) return cache.get(key);
  let img = await decodeBytes(await bytesOf(f), f.type, ctx);
  if (ctx.preview) {
    const k = 1400 / Math.max(img.width, img.height);
    if (k < 1) img = toData(await createImageBitmap(img), Math.round(img.width * k), Math.round(img.height * k));
  }
  cache.set(key, img);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return img;
}

export function flatten(img: ImageData, hex = "#ffffff") {
  const d = new Uint8ClampedArray(img.data), n = parseInt(hex.slice(1), 16), [R, G, B] = [n >> 16, (n >> 8) & 255, n & 255];
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    const k = a / 255;
    d[i] = d[i] * k + R * (1 - k); d[i + 1] = d[i + 1] * k + G * (1 - k); d[i + 2] = d[i + 2] * k + B * (1 - k); d[i + 3] = 255;
  }
  return new ImageData(d, img.width, img.height);
}
export const hasAlpha = (img: ImageData) => { for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 255) return true; return false; };

function bmp(img: ImageData) {
  const { width: w, height: h, data } = img, row = (w * 3 + 3) & ~3, size = 54 + row * h;
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set([0x42, 0x4d]); v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  for (let y = 0; y < h; y++) for (let x = 0, o = 54 + (h - 1 - y) * row, i = y * w * 4; x < w; x++, i += 4, o += 3) { out[o] = data[i + 2]; out[o + 1] = data[i + 1]; out[o + 2] = data[i]; }
  return out;
}

export function ico(pngs: { w: number; h: number; bytes: Uint8Array }[]) {
  const head = 6 + 16 * pngs.length, size = head + pngs.reduce((a, p) => a + p.bytes.length, 0);
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, pngs.length, true);
  let at = head;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    out[e] = p.w >= 256 ? 0 : p.w; out[e + 1] = p.h >= 256 ? 0 : p.h;
    v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true); v.setUint32(e + 8, p.bytes.length, true); v.setUint32(e + 12, at, true);
    out.set(p.bytes, at); at += p.bytes.length;
  });
  return out;
}

export const pngBytes = async (img: ImageData) => new Uint8Array(await (await import("@jsquash/png/encode")).default(img));

export async function encode(img: ImageData, fmt: string, quality = 85, matte = "#ffffff"): Promise<Uint8Array> {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  switch (fmt) {
    case "jpeg": return new Uint8Array(await (await import("@jsquash/jpeg/encode")).default(flatten(img, matte), { quality: q }));
    case "webp": return new Uint8Array(await (await import("@jsquash/webp/encode")).default(img, { quality: q }));
    case "avif": return new Uint8Array(await (await import("@jsquash/avif/encode")).default(img, { quality: q, speed: 7 }));
    case "jxl": return new Uint8Array(await (await import("@jsquash/jxl/encode")).default(img, { quality: q }));
    case "png": return pngBytes(img);
    case "heic": return (await import("./heif")).encodeHeic(flatten(img, matte), q);
    case "bmp": return bmp(flatten(img, matte));
    case "tiff": {
      const UTIF = (await import("utif2")).default;
      return new Uint8Array(UTIF.encodeImage(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height));
    }
    case "gif": {
      const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
      const rgba = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length);
      const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
      const t = palette.findIndex((c: number[]) => c[3] === 0);
      const gif = GIFEncoder();
      gif.writeFrame(applyPalette(rgba, palette, "rgba4444"), img.width, img.height, { palette: palette.map((c: number[]) => c.slice(0, 3)), transparent: t >= 0, transparentIndex: Math.max(t, 0) });
      gif.finish();
      return gif.bytes();
    }
    case "ico": {
      const k = Math.min(1, 256 / Math.max(img.width, img.height));
      const small = k < 1 ? toData(await createImageBitmap(img), Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k))) : img;
      return ico([{ w: small.width, h: small.height, bytes: await pngBytes(small) }]);
    }
  }
  throw new Say(`Unknown format: ${fmt}`);
}

export async function resolveFormat(f: In, wanted: string) {
  if (wanted && wanted !== "auto") return wanted;
  const src = sniff((await bytesOf(f.blob.slice(0, 1024))));
  return EXT[src] && src !== "ico" && src !== "gif" && src !== "bmp" && src !== "tiff" ? src : "png";
}

/** The normal end of an image tool: a fast bitmap during live preview, a real file on export. */
export async function save(img: ImageData, f: In, p: any, ctx: Ctx, suffix = ""): Promise<Out> {
  const fmt = await resolveFormat(f, p.format);
  const name = `${stem(f.name)}${suffix}.${EXT[fmt]}`;
  if (ctx.preview) return { name, type: MIME[fmt], bitmap: await createImageBitmap(img), width: img.width, height: img.height };
  return { name, type: MIME[fmt], bytes: await encode(img, fmt, p.quality ?? 90, p.matte), width: img.width, height: img.height };
}

/** Lanczos3, in premultiplied alpha so edges against transparency stay clean. */
export function lanczos(src: ImageData, w: number, h: number): ImageData {
  if (w === src.width && h === src.height) return src;
  const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const kernel = (x: number) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0);
  const weights = (from: number, to: number) => {
    const scale = Math.max(from / to, 1), radius = 3 * scale, res: { at: number; w: Float32Array }[] = [];
    for (let i = 0; i < to; i++) {
      const c = ((i + 0.5) * from) / to, a = Math.max(0, Math.floor(c - radius)), z = Math.min(from - 1, Math.ceil(c + radius));
      const v = new Float32Array(z - a + 1); let sum = 0;
      for (let j = a; j <= z; j++) { const k = kernel((j + 0.5 - c) / scale); v[j - a] = k; sum += k; }
      for (let j = 0; j < v.length; j++) v[j] /= sum;
      res.push({ at: a, w: v });
    }
    return res;
  };
  const sw = src.width, sh = src.height, sd = src.data, wx = weights(sw, w), wy = weights(sh, h);
  const mid = new Float32Array(w * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < w; x++) {
    const { at, w: v } = wx[x]; let r = 0, g = 0, b = 0, a = 0;
    for (let k = 0; k < v.length; k++) { const i = (y * sw + at + k) * 4, al = sd[i + 3] / 255, t = v[k]; r += sd[i] * al * t; g += sd[i + 1] * al * t; b += sd[i + 2] * al * t; a += sd[i + 3] * t; }
    const o = (y * w + x) * 4; mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const { at, w: v } = wy[y];
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < v.length; k++) { const i = ((at + k) * w + x) * 4, t = v[k]; r += mid[i] * t; g += mid[i + 1] * t; b += mid[i + 2] * t; a += mid[i + 3] * t; }
      const o = (y * w + x) * 4, f = a > 0.5 ? 255 / a : 0;
      out[o] = r * f; out[o + 1] = g * f; out[o + 2] = b * f; out[o + 3] = a;
    }
  }
  return new ImageData(out, w, h);
}

export const joined = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

/**
 * Removes metadata without touching the compressed pixels, or returns null so the caller re-encodes.
 * Walks every scan to the real end of the image, so markers between scans and anything appended after it are dropped.
 */
export function stripJpeg(b: Uint8Array) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)], text = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i + 1] === 0xff) i++;
    const m = b[i + 1];
    if (m === 0xd9) { parts.push(b.subarray(i, i + 2)); return joined(parts); }
    if (m === 0 || m === 0x01 || (m >= 0xd0 && m <= 0xd8) || i + 4 > b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3], end = i + 2 + len;
    if (len < 2 || end > b.length) return null;
    const isApp = m >= 0xe0 && m <= 0xef;
    // Kept only if decoding depends on them: plain JFIF without a thumbnail, the colour profile, and Adobe's colour transform.
    const keep = !isApp && m !== 0xfe || (m === 0xe0 && text(i + 4, 5) === "JFIF\0" && b[i + 16] === 0 && b[i + 17] === 0) || (m === 0xe2 && text(i + 4, 12) === "ICC_PROFILE\0") || (m === 0xee && len === 14 && text(i + 4, 5) === "Adobe");
    if (keep) parts.push(b.subarray(i, end));
    i = end;
    if (m !== 0xda) continue;
    let z = i;
    while (z + 1 < b.length && !(b[z] === 0xff && b[z + 1] !== 0 && !(b[z + 1] >= 0xd0 && b[z + 1] <= 0xd7))) z++;
    if (z + 1 >= b.length) return null;
    parts.push(b.subarray(i, z)); i = z;
  }
  return null;
}
