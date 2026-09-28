"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button, Card, CardTitle } from "@/components/ui/primitives";
import { formatTime } from "@/lib/analysis/taxa";
import type { DemoRecording, Place } from "@/lib/analysis/session";
import type { OahSite } from "@/lib/oah/types";

export interface Chosen {
  file: Blob;
  name: string;
  sample: DemoRecording | null;
}

interface Props {
  sites: OahSite[];
  samples: DemoRecording[];
  chosen: Chosen | null;
  place: Place | null;
  date: string;
  onChoose: (chosen: Chosen, place?: Place, date?: string) => void;
  onPlace: (place: Place | null) => void;
  onDate: (date: string) => void;
  onListen: () => void;
}

const CITY_ORDER = ["CO", "BE", "GH", "OS", "TO"] as const;

export function SetupStep({ sites, samples, chosen, place, date, onChoose, onPlace, onDate, onListen }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  function takeFile(file: File | undefined) {
    if (file) onChoose({ file, name: file.name, sample: null });
  }

  async function takeSample(sample: DemoRecording) {
    setLoadingSample(sample.id);
    setSampleError(null);
    try {
      const res = await fetch(sample.file);
      if (!res.ok) throw new Error(`${res.status}`);
      const site = sites.find((s) => s.code === sample.nearestSiteCode);
      const samplePlace: Place = site && (sample.nearestSiteDistanceKm ?? 99) <= 3
        ? { kind: "site", site }
        : { kind: "point", lat: sample.lat, lon: sample.lon, label: sample.title };
      onChoose({ file: await res.blob(), name: sample.title, sample }, samplePlace, sample.recordedAt?.slice(0, 10) ?? undefined);
    } catch {
      setSampleError("Could not load that recording. Check your connection and try again.");
    } finally {
      setLoadingSample(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
      <Card>
        <CardTitle hint="A phone voice memo, a field recorder file, or the short video the OneAquaHealth app already collects. Up to 10 minutes.">
          1 · Recording
        </CardTitle>
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose an audio or video file"
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            takeFile(e.dataTransfer.files[0]);
          }}
          className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragging ? "border-brand bg-brand-soft" : "border-line-strong hover:border-brand hover:bg-paper-2"
          }`}
        >
          {chosen ? (
            <>
              <p className="font-medium text-ink">{chosen.name}</p>
              <p className="text-sm text-muted">Ready to listen · choose another file to replace it</p>
            </>
          ) : (
            <>
              <p className="font-medium text-ink">Drop a recording here, or click to choose</p>
              <p className="text-sm text-muted">WAV, MP3, M4A, OGG, or an MP4/MOV video with sound</p>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/*"
            data-testid="file-input"
            className="sr-only"
            onChange={(e) => takeFile(e.target.files?.[0])}
          />
        </div>

        {samples.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-medium text-ink-2">Or try a public recording from a OneAquaHealth city</h3>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {samples.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => takeSample(s)}
                    disabled={loadingSample !== null}
                    aria-pressed={chosen?.sample?.id === s.id}
                    className={`flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-paper-2 ${
                      chosen?.sample?.id === s.id ? "bg-brand-soft" : ""
                    }`}
                  >
                    <span>
                      <span className="block font-medium text-ink">{s.title}</span>
                      <span className="block text-xs text-muted">
                        {s.recordist} · {s.license} · xeno-canto
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted">{loadingSample === s.id ? "loading…" : formatTime(s.durationS)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {sampleError && <p className="mt-2 text-sm text-bad">{sampleError}</p>}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle hint="The place and week decide which species are plausible, and link your recording to OneAquaHealth lab results.">
          2 · Where and when
        </CardTitle>
        <PlacePicker sites={sites} place={place} onPlace={onPlace} />
        <label className="mt-4 block text-sm">
          <span className="font-medium text-ink-2">Date recorded</span>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => onDate(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-ink"
          />
        </label>
        <Button className="mt-5 w-full py-3 text-base" disabled={!chosen} onClick={onListen} data-testid="listen">
          Listen
        </Button>
        <p className="mt-2 text-center text-xs text-muted">The recording is analysed on this device and is not uploaded.</p>
      </Card>
    </div>
  );
}

function PlacePicker({ sites, place, onPlace }: { sites: OahSite[]; place: Place | null; onPlace: (p: Place | null) => void }) {
  const selectId = useId();
  const cities = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; sites: OahSite[] }>();
    for (const s of sites) {
      const c = byId.get(s.cityId) ?? { id: s.cityId, name: s.cityName, sites: [] };
      c.sites.push(s);
      byId.set(s.cityId, c);
    }
    for (const c of byId.values()) c.sites.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return CITY_ORDER.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [sites]);

  const [tab, setTab] = useState<string>(place?.kind === "site" ? place.site.cityId : place?.kind === "point" ? "elsewhere" : "CO");
  const current = cities.find((c) => c.id === tab);
  const [lat, setLat] = useState(place?.kind === "point" ? String(place.lat) : "");
  const [lon, setLon] = useState(place?.kind === "point" ? String(place.lon) : "");
  const [geoError, setGeoError] = useState<string | null>(null);

  function setPoint(latText: string, lonText: string) {
    setLat(latText);
    setLon(lonText);
    const la = Number(latText);
    const lo = Number(lonText);
    onPlace(latText && lonText && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? { kind: "point", lat: la, lon: lo, label: `${la.toFixed(4)}, ${lo.toFixed(4)}` } : null);
  }

  return (
    <div>
      <div role="tablist" aria-label="City" className="flex flex-wrap gap-1.5">
        {[...cities.map((c) => ({ id: c.id, name: c.name })), { id: "elsewhere", name: "Elsewhere" }].map((c) => (
          <button
            key={c.id}
            role="tab"
            type="button"
            aria-selected={tab === c.id}
            onClick={() => setTab(c.id)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              tab === c.id ? "border-brand bg-brand-soft font-medium text-brand-ink" : "border-line text-ink-2 hover:border-line-strong"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {current ? (
        <label htmlFor={selectId} className="mt-3 block text-sm">
          <span className="font-medium text-ink-2">OneAquaHealth research site in {current.name}</span>
          <select
            id={selectId}
            value={place?.kind === "site" && place.site.cityId === current.id ? place.site.code : ""}
            onChange={(e) => {
              const site = current.sites.find((s) => s.code === e.target.value);
              onPlace(site ? { kind: "site", site } : null);
            }}
            className="mt-1 block w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-ink"
          >
            <option value="">Choose a site…</option>
            {current.sites.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <label>
            <span className="font-medium text-ink-2">Latitude</span>
            <input inputMode="decimal" value={lat} onChange={(e) => setPoint(e.target.value, lon)} placeholder="21.0285" className="mt-1 block w-full rounded-lg border border-line-strong bg-paper px-3 py-2" />
          </label>
          <label>
            <span className="font-medium text-ink-2">Longitude</span>
            <input inputMode="decimal" value={lon} onChange={(e) => setPoint(lat, e.target.value)} placeholder="105.8542" className="mt-1 block w-full rounded-lg border border-line-strong bg-paper px-3 py-2" />
          </label>
          <Button
            variant="secondary"
            className="col-span-2"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition(
                (pos) => setPoint(pos.coords.latitude.toFixed(5), pos.coords.longitude.toFixed(5)),
                () => setGeoError("Location unavailable. Type the coordinates instead."),
              )
            }
          >
            Use my location
          </Button>
          {geoError && <p className="col-span-2 text-bad">{geoError}</p>}
          <p className="col-span-2 text-xs text-muted">Outside the OneAquaHealth cities there is no lab comparison, and the species range filter applies only within 300 km of a known region.</p>
        </div>
      )}
    </div>
  );
}
