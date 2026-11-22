import { zipSync } from "fflate";
export interface In { id: string; name: string; type: string; size: number; blob: Blob; restricted?: boolean }
export interface Out { name: string; type: string; bytes?: Uint8Array; text?: string; bitmap?: ImageBitmap; note?: string; failed?: string[]; reused?: boolean; swatches?: string[]; width?: number; height?: number }
export interface Ctx {
  preview: boolean;
  progress(p: number, label?: string): void;
  main<T = any>(op: string, args: any, transfer?: Transferable[], onProgress?: (got: number, total: number) => void): Promise<T>;
}
export type Run = (files: In[], p: any, ctx: Ctx) => Promise<Out[]>;

/** An error whose message is written for the person using the tool. */
export class Say extends Error {}

/** What decoding a file lost or changed, by file id, for the result to state. */
export const inputNotes = new Map<string, string>();

/** Runs a tool over each file. One bad file never costs the others their results. */
export async function eachFile(files: In[], ctx: Ctx, fn: (f: In, i: number) => Promise<Out | Out[]>) {
  const out: Out[] = [], failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    if (files.length > 1) ctx.progress(i / files.length, `${files[i].name} (${i + 1} of ${files.length})`);
    try {
      const made = [await fn(files[i], i)].flat(), said = inputNotes.get(files[i].id);
      if (said && !ctx.preview) for (const o of made) o.note = [o.note, said].filter(Boolean).join(" ");
      out.push(...made);
    }
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
/** An entry name that stays inside the folder it is extracted to, on any operating system. */
const safeEntry = (name: string) => name.replace(/[\\:\x00-\x1f]/g, "_").split("/").filter((x) => x && !/^\.+$/.test(x)).map((x) => x.replace(/\.\.+/g, ".")).join("/") || "file";
export const zipOut = (name: string, entries: { name: string; bytes: Uint8Array }[]): Out => {
  const seen = new Map<string, number>();
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const e of entries) {
    const entry = safeEntry(e.name), n = seen.get(entry) ?? 0;
    seen.set(entry, n + 1);
    files[n ? entry.replace(/(\.[^.]+)?$/, ` (${n})$1`) : entry] = [e.bytes, { level: 0 }];
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
