"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Spectrogram } from "@/components/analyze/Spectrogram";
import { identityToken } from "@/lib/identity";
import { Button, Card, Chip } from "@/components/ui/primitives";
import { decodeToMono, type DecodedAudio } from "@/lib/audio/decode";
import { ClipPlayer } from "@/lib/audio/player";
import { computeSpectrogram, type SpectrogramImage } from "@/lib/audio/spectrogram";
import { GROUPS, likelihood, withArticle } from "@/lib/analysis/taxa";
import { afterVote, STATUS_LABEL, type DetectionStatus } from "@/lib/commons/consensus";
import type { QueueItem } from "@/lib/commons/repo";

type Stats = { sessions: number; detections: number; votes: number; agreed: number; expert: number };

const GROUP_OF: Record<string, keyof typeof GROUPS> = { Aves: "bird", Amphibia: "amphibian", Insecta: "insect", Mammalia: "mammal" };

async function loadClip(item: QueueItem): Promise<{ audio: DecodedAudio; image: SpectrogramImage }> {
  const blob = await (await fetch(item.clip.url)).blob();
  const full = await decodeToMono(blob, 32_000);
  const start = Math.round(item.clip.startS * full.sampleRate);
  const samples = full.samples.slice(start, start + item.clip.durationS * full.sampleRate);
  const audio = { ...full, samples, durationS: samples.length / full.sampleRate };
  return { audio, image: computeSpectrogram(samples, full.sampleRate, 12_000, 600) };
}

const noSubscribe = () => () => {};

export function VerifyQueue() {
  // The listener's secret token lives in localStorage: read it on the client only.
  const voter = useSyncExternalStore(noSubscribe, identityToken, () => null);
  const [expertCode, setExpertCode] = useState("");
  const [expertOn, setExpertOn] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [item, setItem] = useState<QueueItem | null | undefined>(undefined);
  const [clip, setClip] = useState<{ audio: DecodedAudio; image: SpectrogramImage } | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [last, setLast] = useState<{ name: string; status: DetectionStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const skipped = useRef<string[]>([]);
  const busy = useRef(false);

  // Load the next call whenever the listener, the mode or reloadKey changes.
  useEffect(() => {
    if (!voter) return;
    let cancelled = false;
    (async () => {
      const skip = skipped.current.length ? `?skip=${skipped.current.slice(-50).join(",")}` : "";
      const headers: Record<string, string> = { "x-murmur-token": voter };
      if (expertOn && expertCode) headers["x-murmur-expert"] = expertCode;
      const [res, statsRes] = await Promise.all([
        fetch(`/api/verify/next${skip}`, { headers }).catch(() => null),
        fetch("/api/commons/stats").catch(() => null),
      ]);
      const body = res ? ((await res.json().catch(() => null)) as { item?: QueueItem | null; error?: string } | null) : null;
      const nextStats = statsRes?.ok ? ((await statsRes.json()) as Stats) : null;
      if (cancelled) return;
      if (nextStats) setStats(nextStats);
      setClip(null);
      setPlayhead(null);
      setLoading(false);
      if (!res?.ok || !body || body.item === undefined) {
        setError(body?.error ?? "Could not reach the listening queue. Check your connection and try again.");
        setItem(null);
        return;
      }
      setError(null);
      setItem(body.item);
      if (!body.item) return;
      try {
        const loaded = await loadClip(body.item);
        if (!cancelled) setClip(loaded);
      } catch {
        if (!cancelled) setError("This clip could not be loaded. Skip it and try the next one.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // expertCode is read when the mode is switched on or the next call loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voter, expertOn, reloadKey]);

  const next = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const skip = useCallback(() => {
    if (item) skipped.current.push(item.id);
    next();
  }, [item, next]);

  const player = useMemo(() => (clip ? new ClipPlayer(clip.audio.samples, clip.audio.sampleRate) : null), [clip]);
  useEffect(() => () => player?.dispose(), [player]);

  const togglePlay = useCallback(() => {
    if (!player || !clip) return;
    if (playhead !== null) {
      player.stop();
      setPlayhead(null);
    } else void player.play(0, clip.audio.durationS, setPlayhead, () => setPlayhead(null));
  }, [player, clip, playhead]);

  const vote = useCallback(
    async (v: "yes" | "no" | "unsure") => {
      if (!item || !voter || busy.current || loading) return;
      busy.current = true;
      try {
        const res = await fetch("/api/verify/vote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ detectionId: item.id, token: voter, vote: v, ...(expertOn && expertCode ? { expertCode } : {}) }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Vote failed");
        setLast({ name: item.en, status: body.status });
        setCount((c) => c + 1);
        next();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        busy.current = false;
      }
    },
    [item, voter, expertOn, expertCode, next, loading],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const key = e.key.toLowerCase();
      if (key === " ") {
        if (target?.closest("button, a")) return; // let Space press the focused control
        e.preventDefault();
        togglePlay();
      } else if (key === "y") void vote("yes");
      else if (key === "n") void vote("no");
      else if (key === "u") void vote("unsure");
      else if (key === "s") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, vote, skip]);

  const group = item ? GROUPS[GROUP_OF[item.className] ?? "other"] : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-4">
        {item === undefined && <Card className="h-80 animate-pulse bg-paper-2" />}
        {item === null && !error && (
          <Card>
            <h2 className="font-display text-xl font-semibold">You have heard every call in the queue</h2>
            <p className="mt-1 text-ink-2">Thank you. Share a recording of your own, or come back when others have.</p>
          </Card>
        )}
        {item === null && error && (
          <Card role="alert">
            <h2 className="font-display text-xl font-semibold">The queue is out of reach</h2>
            <p className="mt-1 text-ink-2">{error}</p>
            <Button className="mt-3" onClick={next}>
              Try again
            </Button>
          </Card>
        )}
        {item && group && (
          <Card data-testid="verify-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">
                  {item.place ?? "Unknown place"} · {item.recordedOn}
                </p>
                <h2 className="font-display text-2xl font-semibold tracking-tight">Is this {withArticle(item.en)}?</h2>
                <p className="text-sm italic text-ink-2">{item.sci}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Chip color={group.color}>{group.label}</Chip>
                <Chip>{STATUS_LABEL[item.status].label}</Chip>
              </div>
            </div>
            <p className="mt-2 text-sm text-ink-2">
              Murmur thinks this is {likelihood(item.maxP).word.toLowerCase()} <span className="font-mono text-xs text-muted">({item.maxP.toFixed(2)})</span>. Listen to the 3 seconds that triggered it.
            </p>
            <div className="mt-4">
              {clip ? (
                <Spectrogram image={clip.image} durationS={clip.audio.durationS} overlays={[]} masked={[]} playheadS={playhead} height={180} onSeek={() => togglePlay()} />
              ) : (
                <div className="h-[180px] animate-pulse rounded-lg border border-line bg-paper-2" />
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={togglePlay} disabled={!clip} data-testid="verify-play">
                {playhead !== null ? "■ Stop" : "▶ Play"} <kbd className="hidden font-mono text-xs text-brand-soft sm:inline">space</kbd>
              </Button>
              <a
                className="text-sm text-muted underline decoration-line-strong underline-offset-2"
                href={`https://xeno-canto.org/explore?query=${encodeURIComponent(item.sci)}`}
                target="_blank"
                rel="noreferrer"
              >
                Reference recordings on xeno-canto
              </a>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Your verdict">
              <button type="button" onClick={() => vote("yes")} disabled={loading} className="rounded-xl bg-ok px-3 py-3 font-medium text-paper hover:opacity-90 disabled:opacity-50" data-testid="vote-yes">
                Yes, that&apos;s it <kbd className="ml-1 hidden font-mono text-xs sm:inline">Y</kbd>
              </button>
              <button type="button" onClick={() => vote("no")} disabled={loading} className="rounded-xl bg-bad px-3 py-3 font-medium text-paper hover:opacity-90 disabled:opacity-50">
                No <kbd className="ml-1 hidden font-mono text-xs sm:inline">N</kbd>
              </button>
              <button type="button" onClick={() => vote("unsure")} disabled={loading} className="rounded-xl border border-line-strong px-3 py-3 font-medium hover:border-ink-2">
                Can&apos;t tell <kbd className="ml-1 hidden font-mono text-xs text-muted sm:inline">U</kbd>
              </button>
              <button type="button" onClick={skip} className="rounded-xl px-3 py-3 text-ink-2 hover:bg-paper-2">
                Skip <kbd className="ml-1 hidden font-mono text-xs text-muted sm:inline">S</kbd>
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-bad">{error}</p>}
          </Card>
        )}
        {last && (
          <p className="text-sm text-ink-2" aria-live="polite">
            {afterVote(last.name, last.status)}
          </p>
        )}
      </div>

      <aside className="space-y-5">
        <Card>
          <h2 className="font-display text-lg font-semibold">How a call becomes trusted</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
            <li>BirdNET suggests a species and keeps the 3 seconds that made it think so.</li>
            <li>The person who recorded it confirms or doubts it by ear.</li>
            <li>Listeners like you vote. Three votes with a two-thirds majority agree or reject the call; the recordist&apos;s own yes counts as one.</li>
            <li>Calls people keep disagreeing about go to an expert, whose decision is final.</li>
          </ol>
          <p className="mt-3 text-xs text-muted">You never see your own recordings here, and you can change a vote by voting again.</p>
        </Card>
        {stats && (
          <Card>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Calls in the commons", stats.detections],
                ["Votes cast", stats.votes],
                ["Agreed or verified", stats.agreed],
                ["Waiting for an expert", stats.expert],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-display text-2xl font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            {count > 0 && <p className="mt-3 text-sm text-brand-ink">You have checked {count} {count === 1 ? "call" : "calls"} this session.</p>}
          </Card>
        )}
        <Card>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={expertOn}
              onChange={(e) => {
                setExpertOn(e.target.checked);
                if (!e.target.checked) setExpertCode("");
              }}
            />
            <span className="font-medium text-ink-2">I am an expert reviewer</span>
          </label>
          {expertOn && (
            <input
              type="password"
              value={expertCode}
              placeholder="Expert code"
              onChange={(e) => {
                setExpertCode(e.target.value);
              }}
              className="mt-2 block w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-sm"
            />
          )}
          <p className="mt-2 text-xs text-muted">Experts see disputed calls first, and their decision settles them.</p>
        </Card>
      </aside>
    </div>
  );
}
