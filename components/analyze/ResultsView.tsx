"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, CardTitle, Chip, Meter } from "@/components/ui/primitives";
import { ClipPlayer } from "@/lib/audio/player";
import type { DecodedAudio } from "@/lib/audio/decode";
import type { SpectrogramImage } from "@/lib/audio/spectrogram";
import { TAGS, type EcologyEntry } from "@/lib/analysis/ecology";
import { summarize } from "@/lib/analysis/postprocess";
import { placeLabel, type DemoRecording, type Place } from "@/lib/analysis/session";
import { summarizeSoundscape } from "@/lib/analysis/soundscape";
import { GROUPS, formatTime, groupOf, likelihood, localName, type SoundGroup } from "@/lib/analysis/taxa";
import type { Label, SpeciesSummary, WindowScores } from "@/lib/analysis/types";
import type { LabSummary } from "@/lib/oah/types";
import { ExportCard } from "./ExportCard";
import { LabCard } from "./LabCard";
import { ShareCard } from "./ShareCard";
import { Spectrogram, type Overlay } from "./Spectrogram";

export type Vote = "yes" | "unsure" | "no";

export interface RangeInfo {
  location: { id: string; name: string; distanceKm: number; model: string } | null;
  week: number;
  allowed: number[] | null;
}

interface Props {
  name: string;
  place: Place | null;
  date: string;
  audio: DecodedAudio;
  image: SpectrogramImage;
  windows: WindowScores[];
  ms: number;
  labels: Label[];
  ecology: Map<number, EcologyEntry>;
  lab: LabSummary | null;
  range: RangeInfo;
  sessionId: string;
  audioSha256: string | null;
  sample: DemoRecording | null;
  audibilityThresholdDb: number;
  votes: Record<number, Vote>;
  onVote: (labelIdx: number, vote: Vote) => void;
  onReset: () => void;
}

const SENSITIVITY = [
  { label: "Sensitive", value: 0.15 },
  { label: "Balanced", value: 0.25 },
  { label: "Strict", value: 0.5 },
];

export function ResultsView(props: Props) {
  const { name, place, date, audio, image, windows, ms, labels, ecology, lab, range, sessionId, audioSha256, sample, audibilityThresholdDb, votes, onVote, onReset } =
    props;
  const [threshold, setThreshold] = useState(0.25);
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);

  const allowed = useMemo(() => (range.allowed ? new Set(range.allowed) : null), [range.allowed]);
  const { species, outOfRange } = useMemo(() => summarize(windows, { threshold, allowed }), [windows, threshold, allowed]);
  const soundscape = useMemo(
    () => summarizeSoundscape(windows, species, labels, ecology, audibilityThresholdDb),
    [windows, species, labels, ecology, audibilityThresholdDb],
  );

  const player = useMemo(() => new ClipPlayer(audio.samples, audio.sampleRate), [audio]);
  useEffect(() => () => player.dispose(), [player]);

  function play(key: string, fromS: number, toS: number) {
    if (playing === key) {
      player.stop();
      setPlaying(null);
      setPlayhead(null);
      return;
    }
    setPlaying(key);
    void player.play(fromS, toS, setPlayhead, () => {
      setPlaying(null);
      setPlayhead(null);
    });
  }

  const overlays: Overlay[] = species.flatMap((s) =>
    s.detections.map((d, i) => ({
      key: `${s.labelIdx}:${i}`,
      startS: d.startS,
      endS: d.endS,
      color: GROUPS[groupOf(labels[s.labelIdx])].color,
      label: labels[s.labelIdx].en,
      selected: selected === s.labelIdx,
    })),
  );
  const masked = windows.filter((w) => w.features.audibilityDb < audibilityThresholdDb).map((w) => ({ startS: w.startS, endS: w.startS + w.realS }));
  const groupsPresent = (Object.keys(GROUPS) as SoundGroup[]).filter((g) => soundscape.byGroup[g] > 0);
  const cityId = place?.kind === "site" ? place.site.cityId : range.location?.id;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">{place ? placeLabel(place) : "Place not given"} · {date}</p>
            <h2 className="font-display text-2xl font-semibold tracking-tight">{name}</h2>
            <p className="mt-1 text-sm text-muted">
              {formatTime(audio.durationS)} · {windows.length} {windows.length === 1 ? "window" : "windows"} of 3 s · analysed on this device in {(ms / 1000).toFixed(1)} s
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => play("all", 0, audio.durationS)} data-testid="play-all">
              {playing === "all" ? "Pause" : "Play recording"}
            </Button>
            <Button variant="ghost" onClick={onReset}>
              New recording
            </Button>
          </div>
        </div>

        <div className="mt-5">
          <Spectrogram
            image={image}
            durationS={audio.durationS}
            overlays={overlays}
            masked={masked}
            playheadS={playhead}
            onSeek={(s) => play("all", s, audio.durationS)}
            onSelect={(key) => {
              const labelIdx = Number(key.split(":")[0]);
              setSelected(labelIdx);
              document.getElementById(`species-${labelIdx}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
          <div className="flex flex-wrap items-center gap-2">
            {groupsPresent.map((g) => (
              <Chip key={g} color={GROUPS[g].color}>
                {GROUPS[g].plural}
              </Chip>
            ))}
            {masked.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="hatch-masked inline-block h-3 w-5 rounded-sm border border-line" /> Too noisy to hear small birds
              </span>
            )}
          </div>
          <div role="radiogroup" aria-label="Sensitivity" className="flex items-center gap-1">
            <span className="mr-1">Sensitivity</span>
            {SENSITIVITY.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={threshold === s.value}
                onClick={() => setThreshold(s.value)}
                className={`rounded-full border px-2.5 py-0.5 ${threshold === s.value ? "border-brand bg-brand-soft text-brand-ink" : "border-line hover:border-line-strong"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section aria-labelledby="heard" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="heard" className="font-display text-xl font-semibold tracking-tight">
              What Murmur heard
            </h2>
            <p className="text-sm text-muted">
              {species.length} species · {Object.values(votes).filter((v) => v === "yes").length} confirmed by you
            </p>
          </div>
          {species.length === 0 ? (
            <Card data-testid="no-species">
              <p className="text-ink-2">No bird or frog calls above the {SENSITIVITY.find((s) => s.value === threshold)?.label.toLowerCase()} threshold.</p>
              <p className="mt-1 text-sm text-muted">
                {soundscape.audibleShare < 0.5
                  ? "Much of this recording was too noisy to hear small birds, so silence here does not mean there were none. Try recording a few metres away from rushing water."
                  : "Try the Sensitive setting, or record for longer at dawn when birds are most vocal."}
              </p>
            </Card>
          ) : (
            <ul className="space-y-3" data-testid="species">
              {species.map((s) => (
                <SpeciesCard
                  key={s.labelIdx}
                  summary={s}
                  label={labels[s.labelIdx]}
                  eco={ecology.get(s.labelIdx)}
                  cityId={cityId}
                  selected={selected === s.labelIdx}
                  playingKey={playing}
                  vote={votes[s.labelIdx]}
                  onPlay={(key, from, to) => {
                    setSelected(s.labelIdx);
                    play(key, from, to);
                  }}
                  onVote={(v) => onVote(s.labelIdx, v)}
                />
              ))}
            </ul>
          )}

          {outOfRange.length > 0 && (
            <details className="rounded-2xl border border-line bg-card px-5 py-3 text-sm">
              <summary className="cursor-pointer text-ink-2">
                {outOfRange.length} more {outOfRange.length === 1 ? "sound" : "sounds"} scored, but not expected in {range.location?.name} in this week
              </summary>
              <p className="mt-2 text-muted">
                The BirdNET range model does not expect these species here at this time of year, so they are more likely confusions than rare visitors. They are listed so nothing is hidden.
              </p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {outOfRange.slice(0, 12).map((o) => (
                  <li key={o.labelIdx} className="flex justify-between gap-2">
                    <span>
                      {labels[o.labelIdx].en} <span className="italic text-muted">{labels[o.labelIdx].sci}</span>
                    </span>
                    <span className="font-mono text-muted">{o.maxP.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <aside className="space-y-5">
          <SoundscapeCard soundscape={soundscape} thresholdDb={audibilityThresholdDb} />
          <OneHealthCard soundscape={soundscape} labels={labels} confirmed={Object.values(votes).filter((v) => v === "yes").length} />
          {lab && <LabCard lab={lab} />}
          <Card>
            <CardTitle hint="Species plausible here and now, from the BirdNET geomodel.">Range filter</CardTitle>
            <p className="text-sm text-ink-2">
              {range.location
                ? `${range.location.name} region, week ${range.week} of 48 · ${range.allowed?.length ?? 0} species expected`
                : "No regional list within 300 km, so every species the model knows was allowed. Treat rare names with care."}
            </p>
          </Card>
          <ShareCard
            sessionId={sessionId}
            place={place}
            date={date}
            week={range.week}
            audio={audio}
            species={species}
            votes={votes}
            labels={labels}
            soundscape={soundscape}
            audioSha256={audioSha256}
            threshold={threshold}
            sample={sample}
          />
          <ExportCard
            sessionId={sessionId}
            name={name}
            place={place}
            date={date}
            species={species}
            votes={votes}
            labels={labels}
            soundscape={soundscape}
            audioSha256={audioSha256}
            threshold={threshold}
            rangeNote={range.location ? `BirdNET geomodel range filter for ${range.location.name}, week ${range.week}` : "no range filter"}
          />
        </aside>
      </div>
    </div>
  );
}

function SpeciesCard({
  summary,
  label,
  eco,
  cityId,
  selected,
  playingKey,
  vote,
  onPlay,
  onVote,
}: {
  summary: SpeciesSummary;
  label: Label;
  eco: EcologyEntry | undefined;
  cityId: string | undefined | null;
  selected: boolean;
  playingKey: string | null;
  vote: Vote | undefined;
  onPlay: (key: string, fromS: number, toS: number) => void;
  onVote: (v: Vote) => void;
}) {
  const group = groupOf(label);
  const color = GROUPS[group].color;
  const local = localName(label, cityId);
  const like = likelihood(summary.maxP);
  const best = summary.detections.reduce((a, b) => (b.maxP > a.maxP ? b : a));
  const clipKey = `clip:${label.idx}`;
  const clipFrom = best.bestWindow * 3;

  return (
    <li
      id={`species-${label.idx}`}
      data-label-idx={label.idx}
      data-max-p={summary.maxP}
      className={`rounded-2xl border bg-card p-4 transition-shadow ${selected ? "border-ink-2 shadow-[0_0_0_3px_var(--brand-soft)]" : "border-line"}`}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight">{local ?? label.en}</h3>
          <p className="text-sm text-ink-2">
            {local && <span>{label.en} · </span>}
            <span className="italic">{label.sci}</span>
          </p>
        </div>
        <div className="w-36 shrink-0 text-right">
          <p className="text-sm font-medium" style={{ color: like.tone === "weak" ? "var(--muted)" : "var(--ink)" }}>
            {like.word} <span className="font-mono text-xs text-muted">{summary.maxP.toFixed(2)}</span>
          </p>
          <div className="mt-1">
            <Meter value={summary.maxP} color={color} label={`Model score for ${label.en}`} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Chip color={color}>{GROUPS[group].label}</Chip>
        {eco?.tags.map((t) => (
          <Chip key={t} title={TAGS[t].hint} color={TAGS[t].tone === "caution" ? "var(--bad)" : TAGS[t].tone === "good" ? "var(--ok)" : undefined}>
            {TAGS[t].label}
          </Chip>
        ))}
        {summary.detections.map((d, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPlay(`det:${label.idx}:${i}`, d.startS, d.endS)}
            className="rounded-full border border-line px-2 py-0.5 font-mono text-xs text-ink-2 hover:border-line-strong"
            aria-label={`Play ${formatTime(d.startS)} to ${formatTime(d.endS)}`}
          >
            {formatTime(d.startS)}–{formatTime(d.endS)}
          </button>
        ))}
      </div>

      {eco?.meaning && (
        <p className="mt-2 text-sm text-ink-2">
          {eco.meaning}
          {eco.sources[0] && (
            <>
              {" "}
              <a href={eco.sources[0].url} target="_blank" rel="noreferrer" className="text-muted underline decoration-line-strong underline-offset-2">
                source
              </a>
            </>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button variant="secondary" onClick={() => onPlay(clipKey, clipFrom, clipFrom + 3)} aria-label={`Play the clearest 3 seconds of ${label.en}`}>
          {playingKey === clipKey ? "■ Stop" : "▶ Play the clip"}
        </Button>
        <span className="text-sm text-muted">Did you hear it?</span>
        {(
          [
            ["yes", "Yes"],
            ["unsure", "Not sure"],
            ["no", "No"],
          ] as const
        ).map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={vote === v}
            onClick={() => onVote(v)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              vote === v
                ? v === "yes"
                  ? "border-ok bg-ok text-paper"
                  : v === "no"
                    ? "border-bad bg-bad text-paper"
                    : "border-warn bg-warn text-paper"
                : "border-line-strong hover:border-ink-2"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </li>
  );
}

function SoundscapeCard({ soundscape, thresholdDb }: { soundscape: ReturnType<typeof summarizeSoundscape>; thresholdDb: number }) {
  const ndsiPct = ((soundscape.ndsi + 1) / 2) * 100;
  return (
    <Card>
      <CardTitle hint="Measured from the sound itself, not from the model.">Soundscape</CardTitle>
      <dl className="space-y-4 text-sm">
        <div>
          <dt className="flex justify-between text-ink-2">
            <span>Clear enough to hear small birds</span>
            <span className="font-mono">{Math.round(soundscape.audibleShare * 100)}%</span>
          </dt>
          <dd className="mt-1.5">
            <Meter value={soundscape.audibleShare} label="Share of the recording clear enough to hear small birds" />
            <p className="mt-1 text-xs text-muted">Windows where song can rise {thresholdDb} dB above the 2–8 kHz background. Rushing water lowers this.</p>
          </dd>
        </div>
        <div>
          <dt className="flex justify-between text-ink-2">
            <span>Nature vs human noise</span>
            <span className="font-mono">NDSI {soundscape.ndsi.toFixed(2)}</span>
          </dt>
          <dd className="mt-1.5">
            <div className="relative h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, var(--human), var(--line) 50%, var(--amphibian))" }}>
              <span className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${ndsiPct}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {soundscape.ndsiWords}. Compares sound energy at 2–11 kHz (birds, insects) with 1–2 kHz (traffic, machinery).
            </p>
          </dd>
        </div>
        <div>
          <dt className="flex justify-between text-ink-2">
            <span>Birds or frogs calling</span>
            <span className="font-mono">{Math.round(soundscape.lifeShare * 100)}% of the time</span>
          </dt>
        </div>
      </dl>
    </Card>
  );
}

function OneHealthCard({ soundscape, labels, confirmed }: { soundscape: ReturnType<typeof summarizeSoundscape>; labels: Label[]; confirmed: number }) {
  const animals = soundscape.byGroup.bird + soundscape.byGroup.amphibian;
  return (
    <Card>
      <CardTitle hint="One recording, three kinds of health.">One Health reading</CardTitle>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-ink">Animals</dt>
          <dd className="text-ink-2">
            {animals === 1 ? "One bird or amphibian species" : `${animals} bird and amphibian species`}
            {confirmed ? `, ${confirmed} confirmed by ear` : ""}.
            {soundscape.indicators.length > 0 && (
              <> Habitat signals: {soundscape.indicators.map((i) => labels[i.labelIdx].en).join(", ")}.</>
            )}
            {soundscape.insectEaters > 0 && <> {soundscape.insectEaters} insect-eating species, part of the natural control of mosquitoes and other disease carriers.</>}
            {soundscape.nonNative > 0 && <> {soundscape.nonNative} non-native species worth reporting.</>}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Environment</dt>
          <dd className="text-ink-2">
            {soundscape.ndsiWords} (NDSI {soundscape.ndsi.toFixed(2)}). {Math.round((1 - soundscape.audibleShare) * 100)}% of the time the stream or traffic was loud enough to mask quiet calls.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">People</dt>
          <dd className="text-ink-2">
            Birdsong or frog calls {Math.round(soundscape.lifeShare * 100)}% of the time. Hearing birds is linked to better mental wellbeing lasting hours (
            <a className="underline decoration-line-strong underline-offset-2" href="https://doi.org/10.1038/s41598-022-20207-6" target="_blank" rel="noreferrer">
              Hammoud et al. 2022
            </a>
            ).
          </dd>
        </div>
      </dl>
    </Card>
  );
}
