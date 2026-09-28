import { fft, hann } from "./fft";

// Acoustic measurements for one analysis window. These are standard
// soundscape-ecology quantities computed from the spectrum, not model
// outputs, so every number shown to a user can be traced to a formula.
export interface WindowFeatures {
  /** RMS level of the real (unpadded) samples, dB relative to full scale. */
  levelDbfs: number;
  /**
   * How far the loudest moments in the 2–8 kHz band (where most small birds
   * sing) rise above that band's background: P95 − P20 of per-frame band
   * energy in dB. Low values mean steady noise such as rushing water fills
   * the band and quiet calls can be masked.
   */
  audibilityDb: number;
  /**
   * Normalized Difference Soundscape Index (Kasten et al. 2012):
   * (biophony − anthropophony) / (biophony + anthropophony), with
   * anthropophony = 1–2 kHz and biophony = 2–11 kHz power. −1..1.
   */
  ndsi: number;
}

export const FRAME = 1024;
export const HOP = 512;
const WINDOW = hann(FRAME);
const EPS = 1e-12;

/** Linear-interpolated percentile, identical to numpy.percentile's default. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function bandBins(sampleRate: number, lowHz: number, highHz: number): [number, number] {
  const binHz = sampleRate / FRAME;
  return [Math.ceil(lowHz / binHz), Math.ceil(highHz / binHz)]; // [start, end)
}

/**
 * Measure one window. `samples` is mono audio in [-1, 1]; frames start at 0
 * and advance by HOP with no padding or centring (the offline benchmark
 * uses the same framing).
 */
export function windowFeatures(samples: Float32Array, sampleRate: number): WindowFeatures {
  const [birdLo, birdHi] = bandBins(sampleRate, 2000, 8000);
  const [anthLo, anthHi] = bandBins(sampleRate, 1000, 2000);
  const [bioLo, bioHi] = bandBins(sampleRate, 2000, 11000);

  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const frameDb: number[] = [];
  let anthro = 0;
  let bio = 0;

  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[start + i] * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);

    let bird = 0;
    for (let k = birdLo; k < birdHi; k++) bird += re[k] * re[k] + im[k] * im[k];
    frameDb.push(10 * Math.log10(bird + EPS));
    for (let k = anthLo; k < anthHi; k++) anthro += re[k] * re[k] + im[k] * im[k];
    for (let k = bioLo; k < bioHi; k++) bio += re[k] * re[k] + im[k] * im[k];
  }

  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / Math.max(1, samples.length));

  return {
    levelDbfs: 20 * Math.log10(rms + EPS),
    audibilityDb: frameDb.length ? percentile(frameDb, 95) - percentile(frameDb, 20) : 0,
    ndsi: bio + anthro > 0 ? (bio - anthro) / (bio + anthro) : 0,
  };
}
