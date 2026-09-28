import type { WindowScores } from "@/lib/analysis/types";
import type { SpectrogramImage } from "@/lib/audio/spectrogram";

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
  vad: { url: string; bytes: number; name: string; license: string; source: string };
  ort: { version: string; wasmPaths: string };
}

export type ToWorker =
  | { type: "load"; manifest: ModelManifest }
  | { type: "analyze"; id: string; samples: Float32Array; floor: number }
  | { type: "screen"; id: string; clips: Float32Array[]; sampleRate: number };

export type FromWorker =
  | { type: "model-progress"; loaded: number; total: number; cached: boolean }
  | { type: "ready"; backend: string; threads: number }
  | { type: "spectrogram"; id: string; image: SpectrogramImage }
  | { type: "analyze-progress"; id: string; done: number; total: number }
  | { type: "result"; id: string; windows: WindowScores[]; ms: number }
  | { type: "screened"; id: string; segments: Array<Array<[number, number]>> }
  | { type: "error"; id?: string; message: string };
