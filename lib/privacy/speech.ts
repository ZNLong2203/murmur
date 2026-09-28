// Speech screening for shared clips. Silero VAD scores 32 ms frames; a run
// of at least MIN_FRAMES frames above THRESHOLD (Silero's default minimum
// speech duration, 250 ms) is treated as someone talking. Birdsong trips
// single frames, never long runs (a dipper call peaked at 3; synthetic
// speech ran for 74). Talking is muted, with padding, before a clip leaves
// the device; a clip that is mostly talking is not shared at all.

export const VAD_RATE = 16_000;
export const VAD_FRAME = 512;
export const VAD_CONTEXT = 64;
export const THRESHOLD = 0.5;
export const MIN_FRAMES = 8;
export const PAD_S = 0.1;
export const MAX_SPEECH_SHARE = 0.5;

const FRAME_S = VAD_FRAME / VAD_RATE;

/** Speech segments in seconds from per-frame probabilities. */
export function speechSegments(probs: ArrayLike<number>, durationS: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let runStart = -1;
  for (let i = 0; i <= probs.length; i++) {
    const on = i < probs.length && probs[i] > THRESHOLD;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      if (i - runStart >= MIN_FRAMES) {
        const start = Math.max(0, runStart * FRAME_S - PAD_S);
        const end = Math.min(durationS, i * FRAME_S + PAD_S);
        const last = out.at(-1);
        if (last && start <= last[1]) last[1] = end;
        else out.push([start, end]);
      }
      runStart = -1;
    }
  }
  return out;
}

export function speechShare(segments: Array<[number, number]>, durationS: number): number {
  return segments.reduce((s, [a, b]) => s + (b - a), 0) / Math.max(1e-9, durationS);
}

/** Silence the segments, with 10 ms fades so muting does not click. */
export function muteSegments(samples: Float32Array, sampleRate: number, segments: Array<[number, number]>): Float32Array {
  const out = samples.slice();
  const fade = Math.round(0.01 * sampleRate);
  for (const [a, b] of segments) {
    const start = Math.max(0, Math.floor(a * sampleRate));
    const end = Math.min(out.length, Math.ceil(b * sampleRate));
    for (let i = start; i < end; i++) {
      const edge = Math.min(i - start, end - 1 - i);
      out[i] *= edge < fade ? 1 - edge / fade : 0;
    }
  }
  return out;
}

/** 2:1 decimation with pair averaging: enough fidelity for voice detection. */
export function downsampleForVad(samples: Float32Array, sampleRate: number): Float32Array {
  const ratio = Math.round(sampleRate / VAD_RATE);
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < ratio; k++) s += samples[i * ratio + k];
    out[i] = s / ratio;
  }
  return out;
}
