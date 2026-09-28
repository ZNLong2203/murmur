import { describe, expect, it } from "vitest";
import { fft, hann } from "./fft";

describe("fft", () => {
  it("puts a pure tone in its bin", () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 64 * i) / n);
    fft(re, im);
    const mag = Array.from(re, (r, k) => Math.hypot(r, im[k]));
    expect(mag.indexOf(Math.max(...mag.slice(0, n / 2)))).toBe(64);
    expect(mag[64]).toBeCloseTo(n / 2, 6);
  });

  it("preserves energy (Parseval)", () => {
    const n = 256;
    const re = new Float64Array(n).map((_, i) => Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.9));
    const im = new Float64Array(n);
    const timeEnergy = re.reduce((s, v) => s + v * v, 0);
    fft(re, im);
    const freqEnergy = re.reduce((s, v, k) => s + v * v + im[k] * im[k], 0) / n;
    expect(freqEnergy).toBeCloseTo(timeEnergy, 6);
  });

  it("rejects lengths that are not a power of two", () => {
    expect(() => fft(new Float64Array(100), new Float64Array(100))).toThrow();
  });
});

describe("hann", () => {
  it("is periodic: zero at the start, peak at n/2", () => {
    const w = hann(8);
    expect(w[0]).toBe(0);
    expect(w[4]).toBeCloseTo(1, 12);
    expect(w[7]).toBeCloseTo(w[1], 12);
  });
});
