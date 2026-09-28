"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@/components/ui/primitives";
import { decodeToMono, type DecodedAudio } from "@/lib/audio/decode";
import type { SpectrogramImage } from "@/lib/audio/spectrogram";
import type { EcologyEntry } from "@/lib/analysis/ecology";
import { loadLabels } from "@/lib/analysis/labels";
import { placeLatLon, samplePlace, type Place, type WorkbenchData } from "@/lib/analysis/session";
import type { Label, WindowScores } from "@/lib/analysis/types";
import { birdnetWeek } from "@/lib/geo";
import { analyzer, type ModelProgress } from "@/lib/ml/analyzer";
import type { OahSite } from "@/lib/oah/types";
import { ListeningStep, type ListeningProgress } from "./ListeningStep";
import { ResultsView, type RangeInfo, type Vote } from "./ResultsView";
import { SetupStep, type Chosen } from "./SetupStep";

type Phase =
  | { kind: "setup" }
  | { kind: "listening"; progress: ListeningProgress; image: SpectrogramImage | null; durationS: number | null }
  | {
      kind: "results";
      audio: DecodedAudio;
      image: SpectrogramImage;
      windows: WindowScores[];
      ms: number;
      labels: Label[];
      range: RangeInfo;
      sessionId: string;
      audioSha256: string | null;
      /** What was chosen when Listen was pressed; later edits cannot change a result. */
      snapshot: { name: string; place: Place | null; date: string; sample: Chosen["sample"] };
    }
  | { kind: "error"; message: string };

interface Props extends WorkbenchData {
  ecology: EcologyEntry[];
  initialSite: OahSite | null;
  initialSampleId: string | null;
}

/** Today in the visitor's own time zone, as YYYY-MM-DD. */
const today = () => new Date().toLocaleDateString("en-CA");

async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function fetchRange(place: Place | null, date: string): Promise<RangeInfo> {
  const week = birdnetWeek(new Date(`${date}T12:00:00Z`));
  if (!place || !Number.isFinite(week)) return { location: null, week, allowed: null };
  const { lat, lon } = placeLatLon(place);
  const res = await fetch(`/api/range?lat=${lat}&lon=${lon}&week=${week}`);
  if (!res.ok) return { location: null, week, allowed: null };
  return (await res.json()) as RangeInfo;
}

export function AnalyzeWorkbench({ sites, samples, labs, audibilityThresholdDb, ecology, initialSite, initialSampleId }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [place, setPlace] = useState<Place | null>(initialSite ? { kind: "site", site: initialSite } : null);
  const [date, setDate] = useState(today);
  const [votes, setVotes] = useState<Record<number, Vote>>({});
  const userTouched = useRef(false);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today();
  const [model, setModel] = useState<{ ready: boolean; progress: ModelProgress | null; failed: boolean }>({ ready: false, progress: null, failed: false });
  const ecologyByIdx = useMemo(() => new Map(ecology.map((e) => [e.labelIdx, e])), [ecology]);

  // Start fetching the model as soon as the page opens, so Listen is quick.
  useEffect(() => {
    analyzer
      .load((progress) => setModel((m) => ({ ...m, progress })))
      .then(() => setModel((m) => ({ ...m, ready: true })))
      .catch(() => setModel((m) => ({ ...m, failed: true })));
  }, []);

  // /analyze?sample=<id> opens with a public recording ready to play.
  useEffect(() => {
    const sample = samples.find((s) => s.id === initialSampleId);
    if (!sample) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(sample.file).catch(() => null);
      if (!res?.ok || cancelled) return;
      const blob = await res.blob();
      // Never overwrite a choice the visitor made while this was loading.
      if (cancelled || userTouched.current) return;
      setChosen({ file: blob, name: sample.title, sample });
      setPlace(samplePlace(sample, sites));
      if (sample.recordedAt) setDate(sample.recordedAt.slice(0, 10));
    })();
    return () => {
      cancelled = true;
    };
  }, [initialSampleId, samples, sites]);

  async function listen() {
    if (!chosen || !dateOk) return;
    userTouched.current = true;
    const snapshot = { name: chosen.name, place, date, sample: chosen.sample };
    setVotes({});
    let image: SpectrogramImage | null = null;
    let durationS: number | null = null;
    const update = (progress: ListeningProgress) => setPhase({ kind: "listening", progress, image, durationS });
    try {
      update({ stage: "model", progress: null });
      const [manifest, labels, range, audioSha256] = await Promise.all([
        analyzer.load((progress) => update({ stage: "model", progress })),
        loadLabels(),
        fetchRange(place, date),
        sha256Hex(chosen.file),
      ]);
      update({ stage: "decoding" });
      const audio = await decodeToMono(chosen.file, manifest.model.sampleRate);
      durationS = audio.durationS;
      update({ stage: "listening", done: 0, total: 1 });
      const { windows, ms } = await analyzer.analyze(audio.samples, {
        onSpectrogram: (img) => {
          image = img;
        },
        onProgress: (done, total) => update({ stage: "listening", done, total }),
      });
      if (!image) throw new Error("The spectrogram was not produced.");
      setPhase({ kind: "results", audio, image, windows, ms, labels, range, sessionId: crypto.randomUUID(), audioSha256, snapshot });
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const resultPlace = phase.kind === "results" ? phase.snapshot.place : place;
  const lab = resultPlace?.kind === "site" ? (labs[resultPlace.site.code] ?? null) : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Listen to a stream</h1>
        <p className="mt-2 text-ink-2">
          Murmur names the birds and frogs in a recording, measures how much of it is water and traffic, and lets you confirm every call by ear. At a OneAquaHealth research site, it sets what you heard beside what the lab found.
        </p>
      </header>

      {phase.kind === "setup" && (
        <SetupStep
          sites={sites}
          samples={samples}
          chosen={chosen}
          place={place}
          date={date}
          onChoose={(c, p, d) => {
            userTouched.current = true;
            setChosen(c);
            if (p) setPlace(p);
            if (d) setDate(d);
          }}
          onPlace={(p) => {
            userTouched.current = true;
            setPlace(p);
          }}
          onDate={(d) => {
            userTouched.current = true;
            setDate(d);
          }}
          dateOk={dateOk}
          onListen={listen}
          model={model}
        />
      )}

      {phase.kind === "listening" && <ListeningStep name={chosen?.name ?? "Recording"} progress={phase.progress} image={phase.image} durationS={phase.durationS} />}

      {phase.kind === "results" && (
        <ResultsView
          name={phase.snapshot.name}
          place={phase.snapshot.place}
          date={phase.snapshot.date}
          audio={phase.audio}
          image={phase.image}
          windows={phase.windows}
          ms={phase.ms}
          labels={phase.labels}
          ecology={ecologyByIdx}
          lab={lab}
          range={phase.range}
          sessionId={phase.sessionId}
          audioSha256={phase.audioSha256}
          sample={phase.snapshot.sample}
          audibilityThresholdDb={audibilityThresholdDb}
          votes={votes}
          onVote={(labelIdx, vote) => setVotes((v) => ({ ...v, [labelIdx]: vote }))}
          onReset={() => setPhase({ kind: "setup" })}
        />
      )}

      {phase.kind === "error" && (
        <Card role="alert">
          <h2 className="font-display text-xl font-semibold">Murmur could not finish listening</h2>
          <p className="mt-1 text-ink-2">{phase.message}</p>
          <Button className="mt-4" onClick={() => setPhase({ kind: "setup" })}>
            Back
          </Button>
        </Card>
      )}
    </main>
  );
}
