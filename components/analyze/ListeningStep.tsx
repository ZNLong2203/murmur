"use client";

import { Card } from "@/components/ui/primitives";
import type { SpectrogramImage } from "@/lib/audio/spectrogram";
import type { ModelProgress } from "@/lib/ml/analyzer";
import { Spectrogram } from "./Spectrogram";

export type ListeningProgress =
  | { stage: "model"; progress: ModelProgress | null }
  | { stage: "decoding" }
  | { stage: "listening"; done: number; total: number };

interface Props {
  name: string;
  progress: ListeningProgress;
  image: SpectrogramImage | null;
  durationS: number | null;
}

const STEPS = [
  { key: "model", label: "Load the listening model" },
  { key: "decoding", label: "Read the recording" },
  { key: "listening", label: "Listen, 3 seconds at a time" },
] as const;

export function ListeningStep({ name, progress, image, durationS }: Props) {
  const currentIndex = STEPS.findIndex((s) => s.key === progress.stage);
  return (
    <Card aria-live="polite">
      <p className="text-sm text-muted">Listening to</p>
      <h2 className="font-display text-2xl font-semibold tracking-tight">{name}</h2>

      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
          return (
            <li key={step.key} className={`rounded-xl border px-3 py-2.5 text-sm ${state === "active" ? "border-brand bg-brand-soft" : "border-line"}`}>
              <span className={state === "todo" ? "text-muted" : "font-medium text-ink"}>
                {state === "done" ? "✓ " : ""}
                {step.label}
              </span>
              <span className="mt-0.5 block font-mono text-xs text-muted" data-testid={state === "active" ? "stage" : undefined}>
                {state === "active" && detail(progress)}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6">
        {image && durationS ? (
          <Spectrogram image={image} durationS={durationS} overlays={[]} masked={[]} playheadS={null} />
        ) : (
          <div className="h-[220px] animate-pulse rounded-lg border border-line bg-paper-2" />
        )}
      </div>
    </Card>
  );
}

function detail(p: ListeningProgress): string {
  if (p.stage === "model") {
    if (!p.progress) return "starting…";
    if (p.progress.cached) return "from this device's cache";
    return `${(p.progress.loaded / 1e6).toFixed(0)} / ${(p.progress.total / 1e6).toFixed(0)} MB · first time only`;
  }
  if (p.stage === "decoding") return "decoding and resampling…";
  return `${p.done} of ${p.total} windows`;
}
