import { describe, expect, it } from "vitest";
import { downsampleForVad, muteSegments, speechSegments, speechShare } from "./speech";

const frames = (pattern: string) => [...pattern].map((c) => (c === "#" ? 0.9 : 0.1));

describe("speechSegments", () => {
  it("ignores short bursts such as bird calls", () => {
    expect(speechSegments(frames("..###....##.."), 3)).toEqual([]);
  });

  it("keeps runs of 250 ms or more, padded and merged", () => {
    const segs = speechSegments(frames("..########........##########"), 3);
    expect(segs).toHaveLength(2);
    expect(segs[0][0]).toBeCloseTo(2 * 0.032 - 0.1 < 0 ? 0 : 2 * 0.032 - 0.1, 6);
    expect(segs[0][1]).toBeCloseTo(10 * 0.032 + 0.1, 6);
  });

  it("measures how much of a clip is talking", () => {
    expect(speechShare([[0, 1], [2, 2.5]], 3)).toBeCloseTo(0.5, 6);
  });
});

describe("muteSegments", () => {
  it("silences the middle of a segment and leaves the rest untouched", () => {
    const out = muteSegments(new Float32Array(1000).fill(1), 1000, [[0.2, 0.6]]);
    expect(out[100]).toBe(1);
    expect(out[400]).toBe(0);
    expect(out[800]).toBe(1);
  });
});

describe("downsampleForVad", () => {
  it("halves 32 kHz audio", () => {
    expect(Array.from(downsampleForVad(new Float32Array([1, 3, 5, 7]), 32_000))).toEqual([2, 6]);
  });
});
