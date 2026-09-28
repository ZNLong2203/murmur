import { percentile } from "./features";
import { fft, hann } from "./fft";

export interface SpectrogramImage {
  cols: number;
  rows: number;
  /** Row-major intensities 0–255; row 0 is the highest frequency. */
  data: Uint8ClampedArray;
  /** Seconds between columns. */
  hopS: number;
  maxHz: number;
}

const N = 512;
const WINDOW = hann(N);

/**
 * A display spectrogram, not an analysis input: n_fft 512 up to `maxHz`,
 * at most `maxCols` columns, dB scaled and stretched between the 5th and
 * 99.5th percentiles of the recording so quiet and loud files both read.
 */
export function computeSpectrogram(samples: Float32Array, sampleRate: number, maxHz = 12_000, maxCols = 1600): SpectrogramImage {
  const rows = Math.min(N / 2, Math.floor((maxHz * N) / sampleRate));
  const hop = Math.max(128, Math.ceil(Math.max(1, samples.length - N) / maxCols));
  const cols = Math.max(1, Math.floor(Math.max(0, samples.length - N) / hop) + 1);

  const db = new Float32Array(rows * cols);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let c = 0; c < cols; c++) {
    const start = c * hop;
    for (let i = 0; i < N; i++) {
      re[i] = (samples[start + i] ?? 0) * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let r = 0; r < rows; r++) {
      const k = rows - r; // flip so row 0 is the top (highest frequency)
      db[r * cols + c] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
    }
  }

  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(db.length / 20_000));
  for (let i = 0; i < db.length; i += stride) sample.push(db[i]);
  const lo = percentile(sample, 5);
  const hi = Math.max(lo + 1, percentile(sample, 99.5));

  const data = new Uint8ClampedArray(db.length);
  for (let i = 0; i < db.length; i++) data[i] = ((db[i] - lo) / (hi - lo)) * 255;
  return { cols, rows, data, hopS: hop / sampleRate, maxHz: (rows * sampleRate) / N };
}
