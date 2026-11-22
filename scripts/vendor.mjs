// Copies engine assets the app serves itself into public/vendor. Runs before dev and build.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const out = "public/vendor";
const copy = (from, to) => { mkdirSync(`${out}/${to}`.replace(/\/[^/]+$/, ""), { recursive: true }); cpSync(`node_modules/${from}`, `${out}/${to}`, { recursive: true }); };
for (const d of ["standard_fonts", "cmaps", "wasm", "iccs"]) copy(`pdfjs-dist/${d}`, `pdfjs/${d}`);
copy("tesseract.js/dist/worker.min.js", "tesseract/worker.min.js");
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) copy(`tesseract.js-core/${f}`, `tesseract/${f}`);
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) copy(`@mediapipe/tasks-vision/wasm/${f}`, `mediapipe/${f}`);
copy("onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs", "ort/ort-wasm-simd-threaded.asyncify.mjs");
const pins = JSON.parse(readFileSync("src/engine/pins.json", "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
// A dependency update must also update the pin, or the app would refuse its own runtime.
if (`sha256-${sha256(readFileSync("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm")).toString("base64")}` !== pins.ortWasm) throw new Error("The ONNX runtime changed. Update ortWasm in src/engine/pins.json.");
mkdirSync(`${out}/tessdata`, { recursive: true });
for (const [lang, want] of Object.entries(pins.tessdata)) {
  const file = `${out}/tessdata/${lang}.traineddata.gz`;
  if (existsSync(file) && sha256(readFileSync(file)).toString("hex") === want) continue;
  const r = await fetch(`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`);
  if (!r.ok) throw new Error(`OCR data download failed for ${lang}: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (sha256(bytes).toString("hex") !== want) throw new Error(`OCR data for ${lang} does not match its pinned SHA-256.`);
  writeFileSync(file, bytes);
}
const model = `${out}/mediapipe/blaze_face_short_range.tflite`;
const MODEL_SHA256 = "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f";
const matches = (bytes) => createHash("sha256").update(bytes).digest("hex") === MODEL_SHA256;
if (!existsSync(model) || !matches(readFileSync(model))) {
  const r = await fetch("https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite");
  if (!r.ok) throw new Error(`Face model download failed: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!matches(bytes)) throw new Error("Face model does not match its pinned SHA-256.");
  writeFileSync(model, bytes);
}
