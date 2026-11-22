import { zipSync } from "fflate";
export interface In { id: string; name: string; type: string; size: number; blob: Blob }
export interface Out { name: string; type: string; bytes?: Uint8Array; text?: string; bitmap?: ImageBitmap; note?: string; failed?: string[]; swatches?: string[]; width?: number; height?: number }
export interface Ctx {
  preview: boolean;
  progress(p: number, label?: string): void;
  main<T = any>(op: string, args: any, transfer?: Transferable[]): Promise<T>;
}
export type Run = (files: In[], p: any, ctx: Ctx) => Promise<Out[]>;

/** An error whose message is written for the person using the tool. */
export class Say extends Error {}

/** Runs a tool over each file. One bad file never costs the others their results. */
export async function eachFile(files: In[], ctx: Ctx, fn: (f: In, i: number) => Promise<Out | Out[]>) {
  const out: Out[] = [], failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    if (files.length > 1) ctx.progress(i / files.length, `${files[i].name} (${i + 1} of ${files.length})`);
    try { out.push(...[await fn(files[i], i)].flat()); }
    catch (e) {
      if (files.length === 1) throw e;
      failed.push(`${files[i].name} (${e instanceof Say ? e.message : "could not be processed"})`);
    }
  }
  if (!out.length) throw new Say(`None of these files could be processed: ${failed.join("; ")}`);
  if (failed.length) out[0].failed = failed;
  return out;
}

export const bytesOf = async (f: In | Blob) => new Uint8Array(await ("blob" in f ? f.blob : f).arrayBuffer());
export const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "file";
export const zipOut = (name: string, entries: { name: string; bytes: Uint8Array }[]): Out => {
  const seen = new Map<string, number>();
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const e of entries) {
    const n = seen.get(e.name) ?? 0;
    seen.set(e.name, n + 1);
    files[n ? e.name.replace(/(\.[^.]+)?$/, ` (${n})$1`) : e.name] = [e.bytes, { level: 0 }];
  }
  return { name, type: "application/zip", bytes: zipSync(files) };
};

/** "1-3, 5, 8-" to zero-based page indexes, in the order written. */
export function parseRanges(text: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const raw of text.split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = raw.match(/^(\d+)?\s*[-–]\s*(\d+)?$/) ?? raw.match(/^(\d+)$/);
    if (!m) throw new Say(`“${raw}” is not a page range. Try something like 1-3, 5, 8-`);
    const single = !raw.match(/[-–]/);
    const a = m[1] ? +m[1] : 1;
    const z = single ? a : m[2] ? +m[2] : total;
    if (a < 1 || z < 1 || a > total || z > total) throw new Say(`“${raw}” is outside this document, which has ${total} page${total === 1 ? "" : "s"}.`);
    const g: number[] = [];
    for (let i = a; a <= z ? i <= z : i >= z; i += a <= z ? 1 : -1) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}
export const pagesIn = (text: string, total: number) => (text?.trim() ? [...new Set(parseRanges(text, total).flat())] : Array.from({ length: total }, (_, i) => i));
