import "server-only";
import { readJson } from "@/lib/content";

// Species names come from the model's own label table (written at build by
// scripts/fetch-models.mjs), never from what a browser sends.

let table: Array<[sci: string, en: string, className: string]> | null = null;

export function serverLabel(idx: number): { sci: string; en: string; className: string } | null {
  table ??= readJson<Array<[string, string, string]>>("generated/labels.json", []);
  const row = table[idx];
  return row ? { sci: row[0], en: row[1], className: row[2] } : null;
}

export function labelCount(): number {
  table ??= readJson<Array<[string, string, string]>>("generated/labels.json", []);
  return table.length;
}
