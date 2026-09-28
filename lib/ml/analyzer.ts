"use client";

import type { WindowScores } from "@/lib/analysis/types";
import type { SpectrogramImage } from "@/lib/audio/spectrogram";
import type { FromWorker, ModelManifest } from "./protocol";

export interface ModelProgress {
  loaded: number;
  total: number;
  cached: boolean;
}

/**
 * Main-thread handle on the analysis worker. One worker and one model per
 * page; loading is idempotent and shared by every caller.
 */
class Analyzer {
  private worker: Worker | null = null;
  private ready: Promise<ModelManifest> | null = null;
  private modelListeners = new Set<(p: ModelProgress) => void>();
  private screens = new Map<string, { resolve: (s: Array<Array<[number, number]>>) => void; reject: (e: Error) => void }>();
  private pending = new Map<
    string,
    {
      resolve: (w: { windows: WindowScores[]; ms: number }) => void;
      reject: (e: Error) => void;
      onProgress?: (done: number, total: number) => void;
      onSpectrogram?: (image: SpectrogramImage) => void;
    }
  >();

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./analyzer.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.handle(event.data);
    // A worker that fails to start or crashes must not leave promises hanging.
    worker.onerror = (event) => this.fail(new Error(event.message || "The listening engine stopped unexpectedly. Reload the page to try again."));
    worker.onmessageerror = () => this.fail(new Error("The listening engine sent an unreadable message."));
    this.worker = worker;
    return worker;
  }

  private loadReject: ((e: Error) => void) | null = null;

  private fail(error: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.loadReject?.(error);
    this.loadReject = null;
    for (const p of this.pending.values()) p.reject(error);
    for (const p of this.screens.values()) p.reject(error);
    this.pending.clear();
    this.screens.clear();
  }

  private handle(msg: FromWorker) {
    if (msg.type === "model-progress") this.modelListeners.forEach((l) => l(msg));
    else if (msg.type === "spectrogram") this.pending.get(msg.id)?.onSpectrogram?.(msg.image);
    else if (msg.type === "analyze-progress") this.pending.get(msg.id)?.onProgress?.(msg.done, msg.total);
    else if (msg.type === "result") {
      this.pending.get(msg.id)?.resolve({ windows: msg.windows, ms: msg.ms });
      this.pending.delete(msg.id);
    } else if (msg.type === "screened") {
      this.screens.get(msg.id)?.resolve(msg.segments);
      this.screens.delete(msg.id);
    } else if (msg.type === "error" && msg.id) {
      this.pending.get(msg.id)?.reject(new Error(msg.message));
      this.pending.delete(msg.id);
      this.screens.get(msg.id)?.reject(new Error(msg.message));
      this.screens.delete(msg.id);
    }
  }

  /** Download (or reuse the cached) model and start an inference session. */
  load(onProgress?: (p: ModelProgress) => void): Promise<ModelManifest> {
    if (onProgress) this.modelListeners.add(onProgress);
    if (this.ready) return this.ready;

    this.ready = (async () => {
      const res = await fetch("/models/manifest.json");
      if (!res.ok) throw new Error("The model manifest is missing. Run `npm run models:fetch`.");
      const manifest = (await res.json()) as ModelManifest;
      const worker = this.spawn();
      await new Promise<void>((resolve, reject) => {
        this.loadReject = reject;
        const listener = (event: MessageEvent<FromWorker>) => {
          if (event.data.type === "ready") {
            worker.removeEventListener("message", listener);
            resolve();
          } else if (event.data.type === "error" && !event.data.id) {
            worker.removeEventListener("message", listener);
            reject(new Error(event.data.message));
          }
        };
        worker.addEventListener("message", listener);
        worker.postMessage({ type: "load", manifest });
      });
      return manifest;
    })().catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  /** Score every 3-second window. The samples buffer is transferred, not copied. */
  async analyze(
    samples: Float32Array,
    handlers: { onProgress?: (done: number, total: number) => void; onSpectrogram?: (image: SpectrogramImage) => void } = {},
    floor = 0.05,
  ) {
    await this.load();
    const id = crypto.randomUUID();
    return new Promise<{ windows: WindowScores[]; ms: number }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ...handlers });
      const copy = samples.slice();
      this.spawn().postMessage({ type: "analyze", id, samples: copy, floor }, [copy.buffer]);
    });
  }

  /** Find human speech in clips (seconds, per clip) with Silero VAD, on the device. */
  async screenSpeech(clips: Float32Array[], sampleRate: number): Promise<Array<Array<[number, number]>>> {
    await this.load();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.screens.set(id, { resolve, reject });
      const copies = clips.map((c) => c.slice());
      this.spawn().postMessage({ type: "screen", id, clips: copies, sampleRate }, copies.map((c) => c.buffer));
    });
  }
}

export const analyzer = new Analyzer();
