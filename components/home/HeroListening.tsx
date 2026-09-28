"use client";

import { useEffect, useMemo, useState } from "react";
import { Spectrogram } from "@/components/analyze/Spectrogram";
import { decodeToMono, type DecodedAudio } from "@/lib/audio/decode";
import { ClipPlayer } from "@/lib/audio/player";
import { computeSpectrogram, type SpectrogramImage } from "@/lib/audio/spectrogram";
import type { DemoRecording } from "@/lib/analysis/session";

// A real public recording from a OneAquaHealth city, drawn in the browser
// with the detections Murmur's offline run found in it. No model download
// on the home page: the spectrogram alone is cheap.

export function HeroListening({ sample }: { sample: DemoRecording }) {
  const [state, setState] = useState<{ audio: DecodedAudio; image: SpectrogramImage } | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await (await fetch(sample.file)).blob();
        const audio = await decodeToMono(blob, 32_000);
        const image = computeSpectrogram(audio.samples, audio.sampleRate, 12_000, 900);
        if (!cancelled) setState({ audio, image });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sample.file]);

  const player = useMemo(() => (state ? new ClipPlayer(state.audio.samples, state.audio.sampleRate) : null), [state]);
  useEffect(() => () => player?.dispose(), [player]);

  const overlays = (sample.detections ?? []).map((d, i) => ({
    key: `${d.labelIdx}:${i}`,
    startS: d.startS,
    endS: d.endS,
    color: "var(--bird)",
    label: d.en,
  }));

  return (
    <figure className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_0_var(--line)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <figcaption className="text-sm">
          <span className="block font-medium text-ink">{sample.title}</span>
          <span className="block text-xs text-muted">
            {sample.recordist} · {sample.license} ·{" "}
            <a className="underline decoration-line-strong underline-offset-2" href={sample.sourceUrl} target="_blank" rel="noreferrer">
              xeno-canto
            </a>
          </span>
        </figcaption>
        <button
          type="button"
          disabled={!player}
          onClick={() => {
            if (!player || !state) return;
            if (playhead !== null) {
              player.stop();
              setPlayhead(null);
            } else void player.play(0, state.audio.durationS, setPlayhead, () => setPlayhead(null));
          }}
          className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-paper hover:bg-brand-ink disabled:bg-line-strong"
        >
          {playhead !== null ? "■ Stop" : "▶ Listen"}
        </button>
      </div>
      {state ? (
        <Spectrogram image={state.image} durationS={state.audio.durationS} overlays={overlays} masked={[]} playheadS={playhead} height={200} />
      ) : (
        <div className="flex h-[200px] items-center justify-center rounded-lg border border-line bg-paper-2 text-sm text-muted">
          {failed ? "This recording could not be loaded." : "Drawing the sound…"}
        </div>
      )}
    </figure>
  );
}
