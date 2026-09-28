import { describe, expect, it } from "vitest";
import { planWindows, sliceWindow, summarize } from "./postprocess";
import type { WindowScores } from "./types";

const F = { levelDbfs: -30, audibilityDb: 12, ndsi: 0.2 };
const win = (index: number, scores: Array<[number, number]>, realS = 3): WindowScores => ({
  index,
  startS: index * 3,
  endS: index * 3 + 3,
  realS,
  scores,
  features: F,
});

describe("planWindows", () => {
  it("keeps full windows and a tail with at least half a window", () => {
    expect(planWindows(96_000 * 2 + 50_000, 96_000).map((w) => w.realSamples)).toEqual([96_000, 96_000, 50_000]);
  });
  it("drops a short tail but never the only window", () => {
    expect(planWindows(96_000 + 10_000, 96_000)).toHaveLength(1);
    expect(planWindows(20_000, 96_000)).toEqual([{ index: 0, start: 0, realSamples: 20_000 }]);
  });
});

describe("sliceWindow", () => {
  it("zero-pads past the end", () => {
    const out = sliceWindow(new Float32Array([1, 2, 3]), 1, 4);
    expect(Array.from(out)).toEqual([2, 3, 0, 0]);
  });
});

describe("summarize", () => {
  const windows = [
    win(0, [[10, 0.9], [20, 0.2]]),
    win(1, [[10, 0.6], [30, 0.7]]),
    win(2, [[20, 0.4]]),
    win(3, [[10, 0.8]], 1.5),
  ];

  it("merges consecutive windows and splits gaps", () => {
    const { species } = summarize(windows, { threshold: 0.3, allowed: null });
    const s10 = species.find((s) => s.labelIdx === 10)!;
    expect(s10.detections).toEqual([
      { labelIdx: 10, startS: 0, endS: 6, maxP: 0.9, bestWindow: 0 },
      { labelIdx: 10, startS: 9, endS: 10.5, maxP: 0.8, bestWindow: 3 },
    ]);
    expect(s10.windows).toBe(3);
  });

  it("applies the threshold and sorts by strongest evidence", () => {
    const { species } = summarize(windows, { threshold: 0.3, allowed: null });
    expect(species.map((s) => s.labelIdx)).toEqual([10, 30, 20]);
    expect(species.find((s) => s.labelIdx === 20)!.windows).toBe(1);
  });

  it("sets aside out-of-range species and reports them", () => {
    const { species, outOfRange } = summarize(windows, { threshold: 0.3, allowed: new Set([10, 20]) });
    expect(species.map((s) => s.labelIdx)).toEqual([10, 20]);
    expect(outOfRange).toEqual([{ labelIdx: 30, maxP: 0.7 }]);
  });
});
