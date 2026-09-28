"use client";

import { useState } from "react";
import { decodeToMono } from "@/lib/audio/decode";
import { analyzer, type ModelProgress } from "@/lib/ml/analyzer";
import { loadLabels } from "@/lib/analysis/labels";
import { summarize } from "@/lib/analysis/postprocess";
import type { AnalysisResult, Label } from "@/lib/analysis/types";

type Stage =
  | { kind: "idle" }
  | { kind: "model"; progress: ModelProgress | null }
  | { kind: "decoding" }
  | { kind: "analysing"; done: number; total: number }
  | { kind: "done"; result: AnalysisResult; labels: Label[]; ms: number }
  | { kind: "error"; message: string };

export function AnalyzeWorkbench() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  async function run(file: File) {
    try {
      setStage({ kind: "model", progress: null });
      const [manifest, labels] = await Promise.all([
        analyzer.load((progress) => setStage({ kind: "model", progress })),
        loadLabels(),
      ]);
      setStage({ kind: "decoding" });
      const audio = await decodeToMono(file, manifest.model.sampleRate);
      setStage({ kind: "analysing", done: 0, total: 1 });
      const { windows, ms } = await analyzer.analyze(audio.samples, (done, total) => setStage({ kind: "analysing", done, total }));
      const summary = summarize(windows, { threshold: 0.25, allowed: null });
      setStage({ kind: "done", result: { durationS: audio.durationS, windows, ...summary }, labels, ms });
    } catch (err) {
      setStage({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Analyse a recording</h1>
      <input
        type="file"
        accept="audio/*,video/*"
        data-testid="file-input"
        className="mt-4 block"
        onChange={(e) => e.target.files?.[0] && run(e.target.files[0])}
      />
      <p data-testid="stage" className="mt-4 text-sm">
        {stage.kind}
        {stage.kind === "model" && stage.progress && ` ${Math.round((100 * stage.progress.loaded) / stage.progress.total)}%`}
        {stage.kind === "analysing" && ` ${stage.done}/${stage.total}`}
      </p>
      {stage.kind === "error" && <p className="text-red-700">{stage.message}</p>}
      {stage.kind === "done" && (
        <ul data-testid="species" className="mt-4 space-y-1">
          {stage.result.species.map((s) => (
            <li key={s.labelIdx}>
              {stage.labels[s.labelIdx].en} ({stage.labels[s.labelIdx].sci}) — {s.maxP.toFixed(2)} in {s.windows} window(s)
            </li>
          ))}
          <li className="text-xs text-neutral-500">{stage.ms} ms for {stage.result.windows.length} windows</li>
        </ul>
      )}
    </main>
  );
}
