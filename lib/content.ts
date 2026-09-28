import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { EcologyEntry } from "@/lib/analysis/ecology";
import type { DemoRecording } from "@/lib/analysis/session";

// Curated content produced by the offline pipeline (pipeline/). Read at
// build time; a missing file means "not generated yet", not an error.

// Scoped to data/ so the server bundle traces that folder, not the project.
function readJson<T>(relative: string, fallback: T): T {
  const file = path.join(process.cwd(), "data", relative);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}

export function loadEcology(): EcologyEntry[] {
  return readJson<EcologyEntry[]>("species/ecology.json", []);
}

export function loadDemoRecordings(): DemoRecording[] {
  return readJson<DemoRecording[]>("demo/recordings.json", []);
}

export function loadGbifKeys(): { source?: string; byLabelIdx: Record<string, { key: number; rank?: string; kingdom?: string; class?: string }> } {
  return readJson("species/gbif.json", { byLabelIdx: {} });
}

export interface SnrBenchmark {
  model?: string;
  createdAt?: string;
  species?: string[];
  nPositives?: number;
  bySnr?: Array<{ snrDb: number; n: number; recall03: number; recall05: number; meanP: number }>;
  bySpecies?: Array<{ sci: string; en: string; bySnr: Array<{ snrDb: number; n: number; recall03: number; recall05?: number; meanP?: number }> }>;
  byAudibility?: Array<{ bin: string; n: number; recall03: number }>;
  falsePositiveRate03?: number;
  suggestedAudibilityThresholdDb?: number;
  noiseRecordings?: unknown[];
  credits?: Array<{ file: string; recordist: string; license: string; url: string }>;
}

export function loadSnrBenchmark(): SnrBenchmark | null {
  return readJson<SnrBenchmark | null>("benchmark/snr.json", null);
}

export interface ParityReport {
  createdAt: string;
  method: string;
  recordings: number;
  pooledJaccard: number;
  results: Array<{ id: string; browser: number; offline: number; shared: number; jaccard: number; meanAbsScoreDiff: number | null }>;
}

export function loadParity(): ParityReport | null {
  return readJson<ParityReport | null>("benchmark/parity.json", null);
}

export interface OahFindings {
  createdAt: string;
  source: string;
  samples: number;
  sampledAfterThreeDryDays: number;
  dryDefinition: string;
  correlations: Array<{ what: string; rho: number; n: number }>;
  note: string;
}

export function loadOahFindings(): OahFindings | null {
  return readJson<OahFindings | null>("benchmark/oah-findings.json", null);
}

/** Below this audibility, small-bird calls are often missed (see /evidence). */
export const AUDIBILITY_THRESHOLD_DB: number = loadSnrBenchmark()?.suggestedAudibilityThresholdDb ?? 6;
