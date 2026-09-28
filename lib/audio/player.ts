"use client";

/**
 * Plays a stretch of an in-memory recording through Web Audio and reports
 * the playhead. One sound at a time: starting a clip stops the last one.
 */
export class ClipPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private raf = 0;

  constructor(
    private samples: Float32Array,
    private sampleRate: number,
  ) {}

  private context(): AudioContext {
    this.ctx ??= new AudioContext();
    if (!this.buffer) {
      this.buffer = this.ctx.createBuffer(1, this.samples.length, this.sampleRate);
      this.buffer.copyToChannel(new Float32Array(this.samples), 0);
    }
    return this.ctx;
  }

  get duration() {
    return this.samples.length / this.sampleRate;
  }

  async play(fromS: number, toS: number, onTick: (s: number) => void, onEnd: () => void) {
    this.stop();
    const ctx = this.context();
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(ctx.destination);
    const startedAt = ctx.currentTime;
    const from = Math.max(0, fromS);
    const length = Math.max(0.05, Math.min(this.duration, toS) - from);
    source.start(0, from, length);
    source.onended = () => {
      if (this.source !== source) return;
      cancelAnimationFrame(this.raf);
      this.source = null;
      onEnd();
    };
    this.source = source;

    const tick = () => {
      onTick(from + (ctx.currentTime - startedAt));
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
  }

  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.buffer = null;
  }
}
