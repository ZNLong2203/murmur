"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SpectrogramImage } from "@/lib/audio/spectrogram";
import { formatTime } from "@/lib/analysis/taxa";

export interface Overlay {
  key: string;
  startS: number;
  endS: number;
  color: string;
  label: string;
  selected?: boolean;
}

interface Props {
  image: SpectrogramImage;
  durationS: number;
  overlays: Overlay[];
  /** Windows too noisy to judge (audibility below the threshold). */
  masked: Array<{ startS: number; endS: number }>;
  playheadS: number | null;
  onSeek?: (s: number) => void;
  onSelect?: (key: string) => void;
  height?: number;
}

function readColor(name: string, fallback: string): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const hex = value.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Paper → brand → ink: quiet is the page, loud is the ink. */
function colormap(): Uint8ClampedArray {
  const stops = [readColor("--paper", "#f7f5ef"), readColor("--brand-soft", "#dcefe9"), readColor("--brand", "#0e6e62"), readColor("--ink", "#14201d")];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    const f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
  }
  return lut;
}

const KHZ_TICKS = [2, 4, 6, 8, 10];

export function Spectrogram({ image, durationS, overlays, masked, playheadS, onSeek, onSelect, height = 220 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const lut = colormap();
    const pixels = ctx.createImageData(image.cols, image.rows);
    for (let i = 0; i < image.data.length; i++) {
      // Gamma lifts mid-level energy (song) above the noise floor.
      const v = Math.round(255 * Math.pow(image.data[i] / 255, 1.6));
      pixels.data[i * 4] = lut[v * 3];
      pixels.data[i * 4 + 1] = lut[v * 3 + 1];
      pixels.data[i * 4 + 2] = lut[v * 3 + 2];
      pixels.data[i * 4 + 3] = 255;
    }
    el.width = image.cols;
    el.height = image.rows;
    ctx.putImageData(pixels, 0, 0);
  }, [image]);

  const ticks = useMemo(() => {
    const step = durationS > 300 ? 60 : durationS > 90 ? 15 : durationS > 30 ? 5 : durationS > 10 ? 2 : 1;
    const out: number[] = [];
    for (let t = 0; t <= durationS; t += step) out.push(t);
    return out;
  }, [durationS]);

  const pct = (s: number) => `${(100 * Math.min(durationS, Math.max(0, s))) / durationS}%`;

  return (
    <figure className="select-none">
      <div className="flex gap-2">
        <div className="relative w-9 shrink-0 font-mono text-[10px] text-muted" style={{ height }} aria-hidden="true">
          {KHZ_TICKS.filter((k) => k * 1000 < image.maxHz).map((k) => (
            <span key={k} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (100 * k * 1000) / image.maxHz}%` }}>
              {k} kHz
            </span>
          ))}
        </div>
        <div
          className="relative min-w-0 flex-1 cursor-crosshair overflow-hidden rounded-lg border border-line bg-paper"
          style={{ height }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek?.(((e.clientX - rect.left) / rect.width) * durationS);
          }}
        >
          <canvas ref={canvas} className="absolute inset-0 h-full w-full" style={{ imageRendering: "auto" }} role="img" aria-label="Spectrogram of the recording: time runs left to right, pitch bottom to top." />
          {masked.map((m, i) => (
            <div key={`m${i}`} className="hatch-masked pointer-events-none absolute inset-y-0" style={{ left: pct(m.startS), width: `calc(${pct(m.endS)} - ${pct(m.startS)})` }} />
          ))}
          {overlays.map((o) => (
            <button
              key={o.key}
              type="button"
              title={`${o.label} · ${formatTime(o.startS)}–${formatTime(o.endS)}`}
              aria-label={`${o.label}, ${formatTime(o.startS)} to ${formatTime(o.endS)}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(o.key);
              }}
              className="absolute bottom-0 top-0 rounded-sm transition-[box-shadow]"
              style={{
                left: pct(o.startS),
                width: `calc(${pct(o.endS)} - ${pct(o.startS)})`,
                background: `color-mix(in srgb, ${o.color} ${o.selected ? 18 : 6}%, transparent)`,
                boxShadow: `inset 0 0 0 ${o.selected ? 2 : 1}px ${o.color}`,
              }}
            >
              <span
                className="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded px-1 text-[10px] font-medium leading-4 text-paper"
                style={{ background: o.color }}
              >
                {o.label}
              </span>
            </button>
          ))}
          {playheadS !== null && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-bad" style={{ left: pct(playheadS) }} />}
        </div>
      </div>
      <div className="relative ml-11 mt-1 h-4 font-mono text-[10px] text-muted" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
            {formatTime(t)}
          </span>
        ))}
      </div>
    </figure>
  );
}
