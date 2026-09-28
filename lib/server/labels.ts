import "server-only";
import { loadEcology, readJson } from "@/lib/content";

// Species names come from the model's own label table (written at build by
// scripts/fetch-models.mjs), never from what a browser sends.

let table: Array<[sci: string, en: string, className: string]> | null = null;
let curatedEn: Map<number, string> | null = null;

export function serverLabel(idx: number): { sci: string; en: string; className: string } | null {
  table ??= readJson<Array<[string, string, string]>>("generated/labels.json", []);
  const row = table[idx];
  return row ? { sci: row[0], en: commonName(idx, row[1], row[0]), className: row[2] } : null;
}

/**
 * The label table repeats the Latin name for many amphibians; the curated
 * ecology notes carry the common name instead. Also applied when reading, so
 * calls saved before this fallback existed read the same way.
 */
export function commonName(idx: number, en: string, sci: string): string {
  if (en !== sci) return en;
  curatedEn ??= new Map(loadEcology().map((e) => [e.labelIdx, e.en]));
  return curatedEn.get(idx) ?? en;
}

export function labelCount(): number {
  table ??= readJson<Array<[string, string, string]>>("generated/labels.json", []);
  return table.length;
}
