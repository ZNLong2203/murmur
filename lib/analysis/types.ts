import type { WindowFeatures } from "@/lib/audio/features";

/** One label of the acoustic model, as shipped in /models/labels.v3.json. */
export interface Label {
  idx: number;
  sci: string;
  en: string;
  className: string; // "Aves", "Amphibia", "Insecta", ...
  order: string;
  names: Partial<Record<"pt" | "fr" | "nl" | "no", string>>;
}

/** Model scores for one 3-second window, kept sparse (p ≥ floor only). */
export interface WindowScores {
  index: number;
  startS: number;
  endS: number;
  /** Seconds of real audio in the window (the last one may be padded). */
  realS: number;
  scores: Array<[labelIdx: number, p: number]>;
  features: WindowFeatures;
}

/** A species heard over one or more consecutive windows. */
export interface Detection {
  labelIdx: number;
  startS: number;
  endS: number;
  maxP: number;
  /** Index of the window with the highest score: the clip to listen to. */
  bestWindow: number;
}

export interface SpeciesSummary {
  labelIdx: number;
  maxP: number;
  windows: number;
  detections: Detection[];
}

export interface AnalysisOptions {
  /** Minimum model score for a detection. */
  threshold: number;
  /** Species allowed at this place and week; null = no range filter. */
  allowed: Set<number> | null;
}

export interface AnalysisResult {
  durationS: number;
  windows: WindowScores[];
  species: SpeciesSummary[];
  /** Labels above threshold that the range filter removed, for transparency. */
  outOfRange: Array<{ labelIdx: number; maxP: number }>;
}
