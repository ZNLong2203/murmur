"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, CardTitle } from "@/components/ui/primitives";
import type { DecodedAudio } from "@/lib/audio/decode";
import { encodeWav, toBase64 } from "@/lib/audio/wav";
import type { DemoRecording, Place } from "@/lib/analysis/session";
import type { SoundscapeSummary } from "@/lib/analysis/soundscape";
import type { Label, SpeciesSummary } from "@/lib/analysis/types";
import { analyzer } from "@/lib/ml/analyzer";
import { MAX_SPEECH_SHARE, muteSegments, speechShare } from "@/lib/privacy/speech";
import { contributorId } from "./ExportCard";
import type { Vote } from "./ResultsView";

const FEELINGS = [
  { key: "joy", label: "Joy" },
  { key: "serenity", label: "Serenity" },
  { key: "anger", label: "Anger" },
  { key: "fear", label: "Fear" },
] as const;

type Feeling = (typeof FEELINGS)[number]["key"];

interface Props {
  sessionId: string;
  place: Place | null;
  date: string;
  week: number | null;
  audio: DecodedAudio;
  species: SpeciesSummary[];
  votes: Record<number, Vote>;
  labels: Label[];
  soundscape: SoundscapeSummary;
  audioSha256: string | null;
  threshold: number;
  sample: DemoRecording | null;
}

type State =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; shared: number; withheld: number; muted: number }
  | { kind: "error"; message: string };

export function ShareCard(props: Props) {
  const { place, audio, species, votes, labels, sample } = props;
  const [state, setState] = useState<State>({ kind: "idle" });
  const [feelings, setFeelings] = useState<Partial<Record<Feeling, number>>>({});
  const kept = species.filter((s) => votes[s.labelIdx] !== "no");
  const clipStart = (s: SpeciesSummary) => s.detections.reduce((a, b) => (b.maxP > a.maxP ? b : a)).bestWindow * 3;

  async function share() {
    try {
      let clips: Array<{ mime: "audio/wav"; dataB64: string } | null> = kept.map(() => null);
      let withheld = 0;
      let muted = 0;

      if (!sample) {
        setState({ kind: "working", step: "Listening for voices in the clips…" });
        const raw = kept.map((s) => {
          const start = Math.round(clipStart(s) * audio.sampleRate);
          return audio.samples.slice(start, start + 3 * audio.sampleRate);
        });
        const segments = await analyzer.screenSpeech(raw, audio.sampleRate);
        clips = raw.map((clip, i) => {
          const durationS = clip.length / audio.sampleRate;
          if (speechShare(segments[i], durationS) > MAX_SPEECH_SHARE) {
            withheld++;
            return null;
          }
          if (segments[i].length) muted++;
          return { mime: "audio/wav", dataB64: toBase64(encodeWav(muteSegments(clip, audio.sampleRate, segments[i]), audio.sampleRate)) };
        });
      }

      setState({ kind: "working", step: "Sharing…" });
      const round = (v: number) => Math.round(v * 1000) / 1000; // ~100 m: never a doorstep
      const body = {
        id: props.sessionId,
        contributor: contributorId(),
        place:
          place?.kind === "site"
            ? { kind: "site", siteCode: place.site.code, cityId: place.site.cityId, lat: place.site.lat, lon: place.site.lon, label: `${place.site.code} · ${place.site.name}, ${place.site.cityName}` }
            : place
              ? { kind: "point", lat: round(place.lat), lon: round(place.lon), label: place.label }
              : null,
        recordedOn: props.date,
        week: props.week,
        durationS: audio.durationS,
        model: "BirdNET+ V3.0 developer preview 3.1",
        threshold: props.threshold,
        soundscape: { ndsi: props.soundscape.ndsi, audibleShare: props.soundscape.audibleShare, lifeShare: props.soundscape.lifeShare, windows: props.soundscape.windows },
        source: sample ? "public-sample" : "upload",
        attribution: sample ? { recordist: sample.recordist, license: sample.license, url: sample.sourceUrl } : null,
        audioSha256: props.audioSha256,
        feelings: Object.keys(feelings).length ? feelings : null,
        detections: kept.map((s, i) => {
          const label = labels[s.labelIdx];
          const vote = votes[s.labelIdx];
          return {
            labelIdx: s.labelIdx,
            sci: label.sci,
            en: label.en,
            className: label.className,
            maxP: s.maxP,
            startS: s.detections[0].startS,
            endS: s.detections.at(-1)!.endS,
            clipStartS: clipStart(s),
            clipUrl: sample ? sample.file : null,
            recordistVote: vote === "yes" || vote === "unsure" ? vote : null,
            clip: clips[i],
          };
        }),
      };
      const res = await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Sharing failed (${res.status})`);
      setState({ kind: "done", shared: kept.length, withheld, muted });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.kind === "done") {
    return (
      <Card data-testid="share-done">
        <CardTitle>Shared with the commons</CardTitle>
        <p className="text-sm text-ink-2">
          {state.shared} {state.shared === 1 ? "call is" : "calls are"} now in the listening queue.
          {state.muted > 0 && ` Voices were muted in ${state.muted} ${state.muted === 1 ? "clip" : "clips"}.`}
          {state.withheld > 0 && ` ${state.withheld} ${state.withheld === 1 ? "clip was" : "clips were"} mostly talking and stayed on your device.`}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Link href="/verify" className="rounded-full bg-brand px-4 py-2 font-medium text-paper hover:bg-brand-ink">
            Listen to others&apos; calls
          </Link>
          {place?.kind === "site" && (
            <Link href={`/sites/${place.site.code}`} className="rounded-full border border-line-strong px-4 py-2 font-medium hover:border-ink-2">
              See {place.site.code}
            </Link>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle hint="Other listeners check each call by ear; agreed calls become trusted data for OneAquaHealth.">Share with the commons</CardTitle>
      <fieldset className="mb-3">
        <legend className="text-sm font-medium text-ink-2">How did the stream make you feel? (optional, as in the OneAquaHealth app)</legend>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
          {FEELINGS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="flex justify-between text-ink-2">
                {f.label} <span className="font-mono text-xs text-muted">{feelings[f.key] ?? "–"}</span>
              </span>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={feelings[f.key] ?? 3}
                onChange={(e) => setFeelings((v) => ({ ...v, [f.key]: Number(e.target.value) }))}
                className="w-full accent-[var(--brand)]"
              />
            </label>
          ))}
        </div>
      </fieldset>
      <details className="mb-3 text-sm text-ink-2">
        <summary className="cursor-pointer">What is shared, and what is not</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>Shared: the {kept.length} calls you did not reject, their 3-second clips, your votes, the soundscape numbers, the site{place?.kind === "point" ? " (rounded to about 100 m)" : ""}, the date and your answers above.</li>
          <li>Never shared: the full recording. Clips are screened on this device for human voices, which are muted before anything is sent.</li>
          <li>You are identified only by a random pseudonym stored in this browser.</li>
        </ul>
      </details>
      <Button className="w-full" onClick={share} disabled={kept.length === 0 || state.kind === "working"} data-testid="share">
        {state.kind === "working" ? state.step : `Share ${kept.length} ${kept.length === 1 ? "call" : "calls"}`}
      </Button>
      {state.kind === "error" && <p className="mt-2 text-sm text-bad">{state.message}</p>}
    </Card>
  );
}
