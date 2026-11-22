import { Say, type Ctx, type In, type Run } from "./core";

const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; onProgress?: (got: number, total: number) => void }>();
let nextCall = 1;
const main = (job: number) => <T>(op: string, args: any, transfer: Transferable[] = [], onProgress?: (got: number, total: number) => void) => new Promise<T>((res, rej) => {
  const id = nextCall++;
  pending.set(id, { res, rej, onProgress });
  postMessage({ t: "call", job, id, op, args }, { transfer });
});

async function engine(id: string): Promise<Run> {
  const { imageTools } = await import("./image");
  if (imageTools[id]) return imageTools[id];
  const { pdfTools } = await import("./pdf");
  return pdfTools[id];
}

self.onmessage = async ({ data: m }) => {
  if (m.t === "callProgress") { pending.get(m.id)?.onProgress?.(m.got, m.total); return; }
  if (m.t === "reply") {
    const c = pending.get(m.id); pending.delete(m.id);
    if (m.error) c?.rej(new Say(m.error)); else c?.res(m.result);
    return;
  }
  if (m.t === "fields") {
    try { const { pdfFields } = await import("./pdf"); postMessage({ t: "done", job: m.job, outs: await pdfFields(m.file as In) }); }
    catch (e) { postMessage({ t: "fail", job: m.job, error: (e as Error).message }); }
    return;
  }
  const ctx: Ctx = { preview: !!m.preview, main: main(m.job), progress: (p, label) => postMessage({ t: "progress", job: m.job, p, label }) };
  try {
    if (m.tool === "thumb") {
      const { load } = await import("./codecs");
      const img = await load(m.files[0], { ...ctx, preview: true }), bitmap = await createImageBitmap(img);
      postMessage({ t: "done", job: m.job, outs: [{ name: "", type: "", bitmap, width: img.width, height: img.height }] }, { transfer: [bitmap] });
      return;
    }
    const run = await engine(m.tool);
    if (!run) throw new Error(`No engine for ${m.tool}`);
    const outs = await run(m.files, m.params, ctx);
    const transfer: Transferable[] = [];
    for (const o of outs) { if (o.bitmap) transfer.push(o.bitmap); else if (o.bytes) { o.bytes = o.bytes.slice(); transfer.push(o.bytes.buffer as ArrayBuffer); } }
    postMessage({ t: "done", job: m.job, outs }, { transfer });
  } catch (e) {
    // An expected refusal can name the file, so only real faults reach the console.
    if (!(e instanceof Say)) console.error(e);
    postMessage({ t: "fail", job: m.job, error: e instanceof Say ? e.message : `Something went wrong: ${(e as Error).message}`, expected: e instanceof Say });
  }
};
