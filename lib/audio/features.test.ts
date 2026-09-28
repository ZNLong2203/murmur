import { describe, expect, it } from "vitest";
import { percentile, windowFeatures } from "./features";

const SR = 32_000;

function tone(hz: number, seconds: number, amp = 0.5, gate?: (t: number) => number) {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = amp * Math.sin(2 * Math.PI * hz * t) * (gate ? gate(t) : 1);
  }
  return out;
}

function noise(seconds: number, amp = 0.2, seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  return new Float32Array(Math.round(SR * seconds)).map(() => amp * rand());
}

describe("percentile", () => {
  it("matches numpy's linear interpolation", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 0, 5], 20)).toBeCloseTo(2, 12);
    expect(percentile([3], 95)).toBe(3);
  });
});

describe("windowFeatures", () => {
  it("scores intermittent song as far more audible than steady noise", () => {
    const song = tone(4000, 3, 0.4, (t) => (Math.floor(t * 4) % 2 === 0 ? 1 : 0.001));
    const water = noise(3);
    expect(windowFeatures(song, SR).audibilityDb).toBeGreaterThan(30);
    expect(windowFeatures(water, SR).audibilityDb).toBeLessThan(3);
  });

  it("gives NDSI below zero for traffic-band sound and above zero for bird-band sound", () => {
    expect(windowFeatures(tone(1500, 3), SR).ndsi).toBeLessThan(-0.9);
    expect(windowFeatures(tone(5000, 3), SR).ndsi).toBeGreaterThan(0.9);
  });

  it("reports level in dBFS", () => {
    const f = windowFeatures(tone(1000, 3, 1), SR);
    expect(f.levelDbfs).toBeCloseTo(-3.01, 1);
  });
});
