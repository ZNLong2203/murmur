import type { EcologyEntry, EcologyTag } from "./ecology";
import { groupOf, type SoundGroup } from "./taxa";
import type { Label, SpeciesSummary, WindowScores } from "./types";

export interface SoundscapeSummary {
  windows: number;
  /** Share of windows loud-song-clear enough to hear small birds. */
  audibleShare: number;
  /** Length-weighted mean NDSI over the recording, −1..1. */
  ndsi: number;
  ndsiWords: string;
  /** Share of windows with at least one bird or amphibian call. */
  lifeShare: number;
  byGroup: Record<SoundGroup, number>;
  indicators: Array<{ labelIdx: number; tags: EcologyTag[] }>;
  insectEaters: number;
  nonNative: number;
}

export function ndsiWords(ndsi: number): string {
  if (ndsi >= 0.5) return "Mostly nature";
  if (ndsi >= 0) return "Mixed, nature ahead";
  if (ndsi >= -0.5) return "Mixed, human noise ahead";
  return "Mostly human noise";
}

const HABITAT_TAGS: EcologyTag[] = ["clean-water", "flowing-water", "riparian-woodland", "reedbed-wetland"];

export function summarizeSoundscape(
  windows: WindowScores[],
  species: SpeciesSummary[],
  labels: Label[],
  ecology: Map<number, EcologyEntry>,
  audibilityThresholdDb: number,
): SoundscapeSummary {
  const total = Math.max(1, windows.length);
  const weight = windows.reduce((s, w) => s + w.realS, 0) || 1;
  const ndsi = windows.reduce((s, w) => s + w.features.ndsi * w.realS, 0) / weight;

  const lifeWindows = new Set<number>();
  const byGroup: Record<SoundGroup, number> = { bird: 0, amphibian: 0, insect: 0, mammal: 0, other: 0 };
  const indicators: SoundscapeSummary["indicators"] = [];
  let insectEaters = 0;
  let nonNative = 0;

  for (const s of species) {
    const group = groupOf(labels[s.labelIdx]);
    byGroup[group]++;
    if (group === "bird" || group === "amphibian") {
      for (const d of s.detections) {
        for (const w of windows) if (w.startS >= d.startS - 1e-6 && w.startS < d.endS - 1e-6) lifeWindows.add(w.index);
      }
    }
    const eco = ecology.get(s.labelIdx);
    if (!eco) continue;
    const habitat = eco.tags.filter((t) => HABITAT_TAGS.includes(t));
    if (habitat.length) indicators.push({ labelIdx: s.labelIdx, tags: habitat });
    if (eco.tags.includes("insect-eater")) insectEaters++;
    if (eco.tags.includes("non-native")) nonNative++;
  }

  return {
    windows: windows.length,
    audibleShare: windows.filter((w) => w.features.audibilityDb >= audibilityThresholdDb).length / total,
    ndsi,
    ndsiWords: ndsiWords(ndsi),
    lifeShare: lifeWindows.size / total,
    byGroup,
    indicators,
    insectEaters,
    nonNative,
  };
}
