"use client";

import type { WindowScores } from "@/lib/analysis/types";
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
  private pending = new Map<
    string,
    { resolve: (w: { windows: WindowScores[]; ms: number }) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void }
  >();

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./analyzer.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.handle(event.data);
    this.worker = worker;
    return worker;
  }

  private handle(msg: FromWorker) {
    if (msg.type === "model-progress") this.modelListeners.forEach((l) => l(msg));
    else if (msg.type === "analyze-progress") this.pending.get(msg.id)?.onProgress?.(msg.done, msg.total);
    else if (msg.type === "result") {
      this.pending.get(msg.id)?.resolve({ windows: msg.windows, ms: msg.ms });
      this.pending.delete(msg.id);
    } else if (msg.type === "error" && msg.id) {
      this.pending.get(msg.id)?.reject(new Error(msg.message));
      this.pending.delete(msg.id);
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
  async analyze(samples: Float32Array, onProgress?: (done: number, total: number) => void, floor = 0.05) {
    await this.load();
    const id = crypto.randomUUID();
    return new Promise<{ windows: WindowScores[]; ms: number }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      const copy = samples.slice();
      this.spawn().postMessage({ type: "analyze", id, samples: copy, floor }, [copy.buffer]);
    });
  }
}

export const analyzer = new Analyzer();
