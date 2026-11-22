// Writes a still HEIC by asking the browser's own HEVC encoder for one keyframe, then wrapping it in a HEIF container.
// Lathe ships no HEVC encoder: no x265 (GPL) in the bundle.
import { Say } from "./core";

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const str = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...parts: (number[] | Uint8Array)[]) => {
  const size = 8 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(size);
  out.set([...u32(size), ...str(type)]);
  let at = 8;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const full = (type: string, version: number, flags: number, ...parts: (number[] | Uint8Array)[]) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);

export function muxHeic(hvcC: Uint8Array, sample: Uint8Array, width: number, height: number, codedW: number, codedH: number, matrix = 1, fullRange = false) {
  const ftyp = box("ftyp", str("heic"), u32(0), str("mif1"), str("heic"));
  const props: Uint8Array[] = [
    box("hvcC", hvcC),
    full("ispe", 0, 0, u32(codedW), u32(codedH)),
    box("colr", str("nclx"), u16(1), u16(13), u16(matrix), [fullRange ? 0x80 : 0]), // sRGB primaries and transfer; matrix and range as the encoder reports them
    full("pixi", 0, 0, [3, 8, 8, 8]),
  ];
  const assoc = [1, 2, 3, 4];
  if (width !== codedW || height !== codedH) {
    const half = (coded: number, clean: number) => [...u32((clean - coded) >>> 0), ...u32(2)];
    props.push(box("clap", u32(width), u32(1), u32(height), u32(1), half(codedW, width), half(codedH, height)));
    assoc.push(5);
  }
  const ipma = full("ipma", 0, 0, u32(1), u16(1), [assoc.length], assoc.map((i) => (i === 1 || i === 5 ? 0x80 | i : i)));
  const iprp = box("iprp", box("ipco", ...props), ipma);
  const build = (offset: number) => full("meta", 0, 0,
    full("hdlr", 0, 0, u32(0), str("pict"), new Array(12).fill(0), [0]),
    full("pitm", 0, 0, u16(1)),
    full("iloc", 0, 0, [0x44, 0x00], u16(1), u16(1), u16(0), u16(1), u32(offset), u32(sample.length)),
    full("iinf", 0, 0, u16(1), full("infe", 2, 0, u16(1), u16(0), str("hvc1"), [0])),
    iprp,
  );
  const metaSize = build(0).length;
  const meta = build(ftyp.length + metaSize + 8);
  const mdat = box("mdat", sample);
  const out = new Uint8Array(ftyp.length + meta.length + mdat.length);
  out.set(ftyp); out.set(meta, ftyp.length); out.set(mdat, ftyp.length + meta.length);
  return out;
}

export async function encodeHeic(img: ImageData, quality: number) {
  if (typeof VideoEncoder === "undefined") throw new Say("This browser has no video encoder, so it cannot write HEIC. Safari can. You can still read HEIC here and export JPEG, WebP or AVIF.");
  const w = img.width + (img.width & 1), h = img.height + (img.height & 1);
  const level = w * h > 8912896 ? "L183" : w * h > 2228224 ? "L153" : "L123";
  const bitsPerPixel = 0.25 + (quality / 100) ** 2.4 * 3.2;
  const config: VideoEncoderConfig = { codec: `hvc1.1.6.${level}.B0`, width: w, height: h, bitrate: Math.round(w * h * bitsPerPixel), framerate: 1, latencyMode: "quality", hardwareAcceleration: "no-preference", ...( { hevc: { format: "hevc" } } as object) };
  const ok = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!ok.supported) throw new Say(`This browser cannot encode HEVC at ${w}×${h}, so it cannot write this HEIC. Safari can. You can still read HEIC here and export JPEG, WebP or AVIF.`);

  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  g.drawImage(await createImageBitmap(img), 0, 0);
  // Repeat the last row and column when the coded size had to be rounded up.
  if (w !== img.width) g.drawImage(canvas, img.width - 1, 0, 1, h, img.width, 0, 1, h);
  if (h !== img.height) g.drawImage(canvas, 0, img.height - 1, w, 1, 0, img.height, w, 1);

  let sample: Uint8Array, hvcC: Uint8Array, failure: Error, matrix = 1, fullRange = false;
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      if (sample) return;
      sample = new Uint8Array(chunk.byteLength); chunk.copyTo(sample);
      const cs = meta?.decoderConfig?.colorSpace;
      if (cs?.matrix) matrix = ({ bt709: 1, bt470bg: 5, smpte170m: 6, "bt2020-ncl": 9 } as Record<string, number>)[cs.matrix] ?? 1;
      fullRange = !!cs?.fullRange;
      const d = meta?.decoderConfig?.description as ArrayBuffer | ArrayBufferView;
      if (d) hvcC = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    },
    error: (e) => { failure = e; },
  });
  enc.configure(config);
  const frame = new VideoFrame(canvas, { timestamp: 0 });
  enc.encode(frame, { keyFrame: true });
  frame.close();
  await enc.flush().catch((e) => { failure ??= e; });
  if (enc.state !== "closed") enc.close();
  if (failure || !sample || !hvcC) throw new Say("The browser's HEVC encoder could not write this image. Try a smaller size, or export AVIF instead.");
  return muxHeic(hvcC, sample, img.width, img.height, w, h, matrix, fullRange);
}
