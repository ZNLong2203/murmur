/// <reference lib="webworker" />
// Runs BirdNET in a Web Worker so the page stays responsive. The recording
// never leaves the device: audio arrives as a transferred Float32Array and
// only sparse scores and acoustic measurements go back.

import * as ort from "onnxruntime-web/wasm";
import { windowFeatures } from "@/lib/audio/features";
import { computeSpectrogram } from "@/lib/audio/spectrogram";
import { planWindows, sliceWindow } from "@/lib/analysis/postprocess";
import { VAD_CONTEXT, VAD_FRAME, VAD_RATE, downsampleForVad, speechSegments } from "@/lib/privacy/speech";
import type { WindowScores } from "@/lib/analysis/types";
import type { FromWorker, ModelManifest, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const CACHE = "murmur-models-v1";
const BATCH = 8;

let session: ort.InferenceSession | null = null;
let vad: Promise<ort.InferenceSession> | null = null;
let manifest: ModelManifest | null = null;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

/** Fetch the model once, with progress, and keep it in Cache Storage. */
async function fetchModel(m: ModelManifest): Promise<Uint8Array> {
  const key = `${m.model.url}?sha256=${m.model.sha256}`;
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(key);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    post({ type: "model-progress", loaded: bytes.byteLength, total: bytes.byteLength, cached: true });
    return bytes;
  }

  const res = await fetch(m.model.url);
  if (!res.ok || !res.body) throw new Error(`Could not download the model (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || m.model.bytes;
  const bytes = new Uint8Array(total);
  const reader = res.body.getReader();
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value, loaded);
    loaded += value.byteLength;
    if (loaded - lastPost > 1_000_000) {
      lastPost = loaded;
      post({ type: "model-progress", loaded, total, cached: false });
    }
  }
  post({ type: "model-progress", loaded, total, cached: false });
  await cache?.put(key, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => undefined);
  return bytes;
}

async function load(m: ModelManifest) {
  manifest = m;
  const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  ort.env.wasm.wasmPaths = m.ort.wasmPaths;
  ort.env.wasm.numThreads = threads;
  const bytes = await fetchModel(m);
  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  post({ type: "ready", backend: "wasm", threads });
}

async function analyze(id: string, samples: Float32Array, floor: number) {
  if (!session || !manifest) throw new Error("The model is not loaded yet.");
  const { sampleRate, windowSamples } = manifest.model;
  const plan = planWindows(samples.length, windowSamples);
  const windows: WindowScores[] = [];
  const started = performance.now();

  // Draw first, listen second: the page can show the sound while it waits.
  const image = computeSpectrogram(samples, sampleRate);
  post({ type: "spectrogram", id, image }, [image.data.buffer]);

  for (let b = 0; b < plan.length; b += BATCH) {
    const batch = plan.slice(b, b + BATCH);
    const input = new Float32Array(batch.length * windowSamples);
    batch.forEach((w, i) => input.set(sliceWindow(samples, w.start, windowSamples), i * windowSamples));

    const out = await session.run({ input: new ort.Tensor("float32", input, [batch.length, windowSamples]) });
    const predictions = out.predictions.data as Float32Array;
    const classes = predictions.length / batch.length;

    batch.forEach((w, i) => {
      const row = predictions.subarray(i * classes, (i + 1) * classes);
      const scores: Array<[number, number]> = [];
      for (let k = 0; k < classes; k++) if (row[k] >= floor) scores.push([k, Math.round(row[k] * 1000) / 1000]);
      scores.sort((a, c) => c[1] - a[1]);
      windows.push({
        index: w.index,
        startS: w.start / sampleRate,
        endS: (w.start + windowSamples) / sampleRate,
        realS: w.realSamples / sampleRate,
        scores,
        features: windowFeatures(samples.subarray(w.start, w.start + w.realSamples), sampleRate),
      });
    });
    post({ type: "analyze-progress", id, done: Math.min(plan.length, b + BATCH), total: plan.length });
  }

  post({ type: "result", id, windows, ms: Math.round(performance.now() - started) });
}

/** Silero VAD over each clip; returns speech segments in clip seconds. */
async function screen(id: string, clips: Float32Array[], sampleRate: number) {
  if (!manifest) throw new Error("The model is not loaded yet.");
  const m = manifest;
  vad ??= fetch(m.vad.url)
    .then((r) => r.arrayBuffer())
    .then((buf) => ort.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] }));
  const detector = await vad;
  const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(VAD_RATE)]), []);

  const segments: Array<Array<[number, number]>> = [];
  for (const clip of clips) {
    const x = downsampleForVad(clip, sampleRate);
    let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    let context = new Float32Array(VAD_CONTEXT);
    const probs: number[] = [];
    for (let i = 0; i + VAD_FRAME <= x.length; i += VAD_FRAME) {
      const frame = x.subarray(i, i + VAD_FRAME);
      const input = new Float32Array(VAD_CONTEXT + VAD_FRAME);
      input.set(context);
      input.set(frame, VAD_CONTEXT);
      const out = await detector.run({ input: new ort.Tensor("float32", input, [1, input.length]), state, sr });
      probs.push((out.output.data as Float32Array)[0]);
      state = out.stateN as ort.Tensor;
      context = frame.slice(VAD_FRAME - VAD_CONTEXT);
    }
    segments.push(speechSegments(probs, clip.length / sampleRate));
  }
  post({ type: "screened", id, segments });
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    if (msg.type === "load") await load(msg.manifest);
    else if (msg.type === "analyze") await analyze(msg.id, msg.samples, msg.floor);
    else if (msg.type === "screen") await screen(msg.id, msg.clips, msg.sampleRate);
  } catch (err) {
    post({ type: "error", id: msg.type === "load" ? undefined : msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
