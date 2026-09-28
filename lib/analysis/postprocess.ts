import type { AnalysisOptions, Detection, SpeciesSummary, WindowScores } from "./types";

/**
 * Plan the 3-second analysis windows for a recording. Consecutive, no
 * overlap (BirdNET's default). A trailing window with less than half a
 * window of real audio is dropped: zero padding alone makes the model
 * guess, and a guess on silence is the worst kind of false positive.
 */
export function planWindows(totalSamples: number, windowSamples: number): Array<{ index: number; start: number; realSamples: number }> {
  const plan = [];
  for (let index = 0, start = 0; start < totalSamples; index++, start += windowSamples) {
    const realSamples = Math.min(windowSamples, totalSamples - start);
    if (realSamples < windowSamples / 2 && index > 0) break;
    plan.push({ index, start, realSamples });
  }
  return plan;
}

/** Copy one window out of the recording, zero-padding the tail. */
export function sliceWindow(samples: Float32Array, start: number, windowSamples: number): Float32Array {
  const out = new Float32Array(windowSamples);
  out.set(samples.subarray(start, Math.min(samples.length, start + windowSamples)));
  return out;
}

/**
 * Turn per-window scores into per-species detections. Scores at or above the
 * threshold count; species outside the place-and-week range list are set
 * aside (and reported) rather than silently dropped. Consecutive windows of
 * the same species merge into one detection.
 */
export function summarize(windows: WindowScores[], options: AnalysisOptions) {
  const hits = new Map<number, Array<{ window: WindowScores; p: number }>>();
  const outOfRange = new Map<number, number>();

  for (const window of windows) {
    for (const [labelIdx, p] of window.scores) {
      if (p < options.threshold) continue;
      if (options.allowed && !options.allowed.has(labelIdx)) {
        outOfRange.set(labelIdx, Math.max(p, outOfRange.get(labelIdx) ?? 0));
        continue;
      }
      const list = hits.get(labelIdx) ?? [];
      list.push({ window, p });
      hits.set(labelIdx, list);
    }
  }

  const species: SpeciesSummary[] = [];
  for (const [labelIdx, list] of hits) {
    list.sort((a, b) => a.window.index - b.window.index);
    const detections: Detection[] = [];
    for (const { window, p } of list) {
      const last = detections.at(-1);
      if (last && Math.abs(last.endS - window.startS) < 1e-6) {
        last.endS = window.startS + window.realS;
        if (p > last.maxP) {
          last.maxP = p;
          last.bestWindow = window.index;
        }
      } else {
        detections.push({ labelIdx, startS: window.startS, endS: window.startS + window.realS, maxP: p, bestWindow: window.index });
      }
    }
    species.push({
      labelIdx,
      maxP: Math.max(...detections.map((d) => d.maxP)),
      windows: list.length,
      detections,
    });
  }

  species.sort((a, b) => b.maxP - a.maxP || b.windows - a.windows);
  return {
    species,
    outOfRange: [...outOfRange].map(([labelIdx, maxP]) => ({ labelIdx, maxP })).sort((a, b) => b.maxP - a.maxP),
  };
}
