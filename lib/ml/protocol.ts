import type { WindowScores } from "@/lib/analysis/types";

export interface ModelManifest {
  model: {
    url: string;
    bytes: number;
    sha256: string;
    name: string;
    sampleRate: number;
    windowSamples: number;
    license: string;
    source: string;
  };
  labels: { url: string; count: number; locales: string[] };
  ort: { version: string; wasmPaths: string };
}

export type ToWorker =
  | { type: "load"; manifest: ModelManifest }
  | { type: "analyze"; id: string; samples: Float32Array; floor: number };

export type FromWorker =
  | { type: "model-progress"; loaded: number; total: number; cached: boolean }
  | { type: "ready"; backend: string; threads: number }
  | { type: "analyze-progress"; id: string; done: number; total: number }
  | { type: "result"; id: string; windows: WindowScores[]; ms: number }
  | { type: "error"; id?: string; message: string };
