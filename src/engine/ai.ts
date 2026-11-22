import { pipeline, env, RawImage } from "@huggingface/transformers";
import type { Ctx } from "./core";

env.allowLocalModels = false;
// The runtime's loader is served from this site because a cross-origin copy would need a blob: URL, which the CSP forbids.
// Its 26 MB binary exceeds the host's file limit, so that one file comes from a CDN, pinned to the installed version.
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL("/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs", self.location.origin).href,
  wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${env.backends.onnx.versions?.web}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
};

// Pinned, so a change upstream cannot alter what runs on someone's device.
const REVISION: Record<string, string> = {"jiabins0303/birefnet-lite-1024-webgpu": "1ad01cef0f4101a285c5a3e0bd7f15597d93403f", "Xenova/modnet": "fa2fa546052fba4c08921230a26cc69a333fca12", "Xenova/swin2SR-classical-sr-x2-64": "71e28a83cfb61f5dc95bafdeebf2815167914f2b"};
const CUTOUT_GPU = "jiabins0303/birefnet-lite-1024-webgpu", CUTOUT_CPU = "Xenova/modnet", UPSCALE = "Xenova/swin2SR-classical-sr-x2-64";

const hasGPU = async () => { try { return !!(await (navigator as any).gpu?.requestAdapter()); } catch { return false; } };
const loaded = new Map<string, Promise<any>>();

function load(task: any, model: string, gpu: string, cpu: string, ctx: Ctx, forceCpu = false): Promise<{ pipe: any; device: string }> {
  const key = `${task}:${model}:${forceCpu}`;
  if (!loaded.has(key)) {
    const seen = new Map<string, [number, number]>();
    const progress_callback = (e: any) => {
      if (e.status !== "progress") return;
      seen.set(e.file, [e.loaded, e.total]);
      let a = 0, z = 0;
      for (const [l, t] of seen.values()) { a += l; z += t; }
      ctx.progress(z ? (a / z) * 0.9 : 0, `Downloading model, ${(a / 1e6).toFixed(0)} of ${(z / 1e6).toFixed(0)} MB`);
    };
    loaded.set(key, (async () => {
      if (!forceCpu && await hasGPU()) {
        try { return { pipe: await pipeline(task, model, { device: "webgpu", dtype: gpu as any, revision: REVISION[model], progress_callback }), device: "webgpu" }; }
        catch (e) { console.warn("WebGPU failed, using WebAssembly", e); }
      }
      return { pipe: await pipeline(task, model, { device: "wasm", dtype: cpu as any, revision: REVISION[model], progress_callback }), device: "wasm" };
    })().catch((e) => { loaded.delete(key); throw e; }));
  }
  return loaded.get(key);
}

/** Runs on the GPU when it can. A GPU that loads a model but fails during inference falls back to the CPU. */
async function infer(task: any, model: string, gpu: string, cpu: string, ctx: Ctx, call: (pipe: any, device: string) => Promise<any>) {
  const first = await load(task, model, gpu, cpu, ctx);
  try { return await call(first.pipe, first.device); }
  catch (e) {
    if (first.device !== "webgpu") throw e;
    console.warn("WebGPU inference failed, using WebAssembly", e);
    ctx.progress(0.5, "Switching to CPU");
    const next = await load(task, model, gpu, cpu, ctx, true);
    return call(next.pipe, next.device);
  }
}

const raw = (img: ImageData) => new RawImage(new Uint8ClampedArray(img.data), img.width, img.height, 4);

/** Returns an alpha matte the size of the input. */
export async function matte(img: ImageData, ctx: Ctx): Promise<Uint8ClampedArray> {
  let out: any;
  if (await hasGPU()) {
    try {
      const { pipe, device } = await load("background-removal", CUTOUT_GPU, "fp16", "fp16", ctx);
      if (device === "webgpu") { ctx.progress(0.92, "Finding the subject on your GPU"); out = [await pipe(raw(img))].flat()[0]; }
    } catch (e) { console.warn("WebGPU cutout failed, using the CPU model", e); }
  }
  if (!out) {
    // BiRefNet needs 1024 px input, which exhausts WebAssembly memory. MODNet is small and tuned for people.
    const { pipe } = await load("background-removal", CUTOUT_CPU, "q8", "q8", ctx, true);
    ctx.progress(0.92, "Finding the subject on your CPU");
    out = [await pipe(raw(img))].flat()[0];
  }
  const a = new Uint8ClampedArray(img.width * img.height);
  const src = out.width === img.width && out.height === img.height ? out : await out.resize(img.width, img.height);
  const ch = src.channels;
  for (let i = 0; i < a.length; i++) a[i] = src.data[i * ch + ch - 1];
  return a;
}

/** Super-resolution x2 in overlapping tiles, so large images do not exhaust memory. */
export async function upscale(img: ImageData, ctx: Ctx): Promise<ImageData> {
  const T = 192, O = 16, S = 2, w = img.width, h = img.height;
  const out = new Float32Array(w * S * h * S * 4), sum = new Float32Array(w * S * h * S);
  const stepsX = Math.max(1, Math.ceil((w - O) / (T - O))), stepsY = Math.max(1, Math.ceil((h - O) / (T - O)));
  const source = new OffscreenCanvas(w, h), g = source.getContext("2d", { willReadFrequently: true });
  g.putImageData(img, 0, 0);
  let done = 0;
  for (let j = 0; j < stepsY; j++) for (let i = 0; i < stepsX; i++) {
    const x = Math.max(0, Math.min(w - T, i * (T - O))), y = Math.max(0, Math.min(h - T, j * (T - O)));
    const tw = Math.min(T, w), th = Math.min(T, h);
    const tile = g.getImageData(x, y, tw, th);
    const res = await infer("image-to-image", UPSCALE, "fp32", "q8", ctx, (up) => up(raw(tile)));
    const r = Array.isArray(res) ? res[0] : res, ch = r.channels;
    const tileW = tw * S, tileH = th * S, scaleX = r.width / tileW, scaleY = r.height / tileH;
    for (let b = 0; b < tileH; b++) for (let a = 0; a < tileW; a++) {
      const edge = Math.min(a + 1, b + 1, tileW - a, tileH - b), weight = Math.min(1, edge / (O * S));
      const si = (Math.floor(b * scaleY) * r.width + Math.floor(a * scaleX)) * ch, di = ((y * S + b) * w * S + x * S + a);
      for (let c = 0; c < 3; c++) out[di * 4 + c] += r.data[si + c] * weight;
      out[di * 4 + 3] += (tile.data[((b >> 1) * tw + (a >> 1)) * 4 + 3]) * weight;
      sum[di] += weight;
    }
    ctx.progress(++done / (stepsX * stepsY), `Upscaling tile ${done} of ${stepsX * stepsY}`);
  }
  const data = new Uint8ClampedArray(out.length);
  for (let i = 0; i < sum.length; i++) { const k = sum[i] || 1; for (let c = 0; c < 4; c++) data[i * 4 + c] = out[i * 4 + c] / k; }
  return new ImageData(data, w * S, h * S);
}
