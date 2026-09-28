import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { EcologyEntry } from "@/lib/analysis/ecology";
import type { DemoRecording } from "@/lib/analysis/session";

// Curated content produced by the offline pipeline (pipeline/). Read at
// build time; a missing file means "not generated yet", not an error.

function readJson<T>(relative: string, fallback: T): T {
  const file = path.join(process.cwd(), relative);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}

export function loadEcology(): EcologyEntry[] {
  return readJson<EcologyEntry[]>("data/species/ecology.json", []);
}

export function loadDemoRecordings(): DemoRecording[] {
  return readJson<DemoRecording[]>("data/demo/recordings.json", []);
}

export function loadGbifKeys(): { source?: string; byLabelIdx: Record<string, { key: number; rank?: string; kingdom?: string; class?: string }> } {
  return readJson("data/species/gbif.json", { byLabelIdx: {} });
}

interface Benchmark {
  suggestedAudibilityThresholdDb?: number;
}

/** Below this audibility, small-bird calls are often missed (see /evidence). */
export const AUDIBILITY_THRESHOLD_DB: number = readJson<Benchmark>("data/benchmark/snr.json", {}).suggestedAudibilityThresholdDb ?? 6;
