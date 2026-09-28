"use client";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, LngLatBoundsLike, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Chip } from "@/components/ui/primitives";
import { STATUS_LABEL } from "@/lib/commons/consensus";

export interface MapSite {
  code: string;
  name: string;
  cityId: string;
  cityName: string;
  lat: number;
  lon: number;
  risk: number | null;
  riskDate: string | null;
  sessions: number;
  heard: number;
  trusted: number;
  topSpecies: Array<{ en: string; status: keyof typeof STATUS_LABEL }>;
}

type Mode = "lab" | "heard";

// Map paint cannot read CSS variables, so the palette is mirrored here.
const COLORS = { low: "#2c7a4b", moderate: "#a8650c", high: "#b42318", none: "#9aa5a1", heard: "#0e6e62", quiet: "#bdb9ab" };

function riskColor(risk: number | null) {
  if (risk == null) return COLORS.none;
  if (risk < 0.25) return COLORS.low;
  if (risk < 0.5) return COLORS.moderate;
  return COLORS.high;
}

function toGeoJson(sites: MapSite[], mode: Mode): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sites.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        code: s.code,
        color: mode === "lab" ? riskColor(s.risk) : s.heard > 0 ? COLORS.heard : COLORS.quiet,
        radius: mode === "lab" ? 7 : s.heard > 0 ? 6 + Math.min(10, s.heard) : 4,
        stroke: mode === "heard" && s.trusted > 0 ? 3 : 1.5,
      },
    })),
  };
}

const CITIES = [
  { id: "CO", name: "Coimbra" },
  { id: "BE", name: "Benevento" },
  { id: "GH", name: "Ghent" },
  { id: "OS", name: "Oslo" },
  { id: "TO", name: "Toulouse" },
];

function boundsOf(sites: MapSite[]): LngLatBoundsLike {
  const lons = sites.map((s) => s.lon);
  const lats = sites.map((s) => s.lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export function StreamsMap({ sites }: { sites: MapSite[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [mode, setMode] = useState<Mode>("lab");
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const site = useMemo(() => sites.find((s) => s.code === selected) ?? null, [sites, selected]);

  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const m = new maplibregl.Map({
      container: container.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      bounds: boundsOf(sites),
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("error", (e) => {
      if (String(e.error?.message ?? "").includes("Failed to fetch")) setFailed(true);
    });
    m.on("load", () => {
      m.addSource("sites", { type: "geojson", data: toGeoJson(sites, "lab") });
      m.addLayer({
        id: "sites",
        type: "circle",
        source: "sites",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["get", "radius"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["get", "stroke"],
          "circle-opacity": 0.9,
        },
      });
      m.on("click", "sites", (e: MapLayerMouseEvent) => setSelected(String(e.features?.[0]?.properties?.code ?? "")));
      m.on("mouseenter", "sites", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "sites", () => (m.getCanvas().style.cursor = ""));
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [sites]);

  useEffect(() => {
    const source = map.current?.getSource("sites") as GeoJSONSource | undefined;
    source?.setData(toGeoJson(sites, mode));
  }, [mode, sites]);

  function flyToCity(cityId: string) {
    const citySites = sites.filter((s) => s.cityId === cityId);
    if (citySites.length) map.current?.fitBounds(boundsOf(citySites), { padding: 60, maxZoom: 14 });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Map layer" className="flex gap-1 rounded-full border border-line bg-card p-1 text-sm">
            {(
              [
                ["lab", "What the lab found"],
                ["heard", "What people heard"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={`rounded-full px-3 py-1 ${mode === value ? "bg-brand text-paper" : "text-ink-2 hover:bg-paper-2"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CITIES.map((c) => (
              <button key={c.id} type="button" onClick={() => flyToCity(c.id)} className="rounded-full border border-line px-3 py-1 text-sm text-ink-2 hover:border-line-strong">
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="relative h-[62vh] min-h-[420px] overflow-hidden rounded-2xl border border-line">
          <div ref={container} className="h-full w-full" />
          {failed && (
            <p className="absolute inset-x-4 top-4 rounded-lg bg-card px-3 py-2 text-sm text-ink-2 shadow">The base map could not load; site markers still work.</p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
          {mode === "lab" ? (
            <>
              <Legend color={COLORS.low} label="Low microbial risk" />
              <Legend color={COLORS.moderate} label="Moderate" />
              <Legend color={COLORS.high} label="High" />
              <Legend color={COLORS.none} label="Not sampled" />
              <span>OneAquaHealth health-risk score (pathogens, faecal bacteria, resistance genes), 2023–24</span>
            </>
          ) : (
            <>
              <Legend color={COLORS.heard} label="Species heard (size = count)" />
              <Legend color={COLORS.quiet} label="No recordings yet" />
              <span>Thick outline: at least one call agreed by the community</span>
            </>
          )}
        </div>
      </div>

      <aside>
        {site ? (
          <Card data-testid="site-panel">
            <p className="text-sm text-muted">
              {site.code} · {site.cityName}
            </p>
            <h2 className="font-display text-2xl font-semibold tracking-tight">{site.name}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Lab health risk</dt>
                <dd className="font-medium" style={{ color: riskColor(site.risk) }}>
                  {site.risk == null ? "Not sampled" : `${site.risk.toFixed(2)} · ${site.risk < 0.25 ? "Low" : site.risk < 0.5 ? "Moderate" : "High"}`}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Recordings shared</dt>
                <dd className="font-medium">{site.sessions}</dd>
              </div>
              <div>
                <dt className="text-muted">Species heard</dt>
                <dd className="font-medium">{site.heard}</dd>
              </div>
              <div>
                <dt className="text-muted">Agreed by listeners</dt>
                <dd className="font-medium">{site.trusted}</dd>
              </div>
            </dl>
            {site.topSpecies.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {site.topSpecies.map((s) => (
                  <Chip key={s.en} color={STATUS_LABEL[s.status].tone === "good" ? "var(--ok)" : undefined}>
                    {s.en}
                  </Chip>
                ))}
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              <Link href={`/sites/${site.code}`} className="rounded-full bg-brand px-4 py-2 font-medium text-paper hover:bg-brand-ink">
                Open site
              </Link>
              <Link href={`/analyze?site=${site.code}`} className="rounded-full border border-line-strong px-4 py-2 font-medium hover:border-ink-2">
                Add a recording here
              </Link>
            </div>
          </Card>
        ) : (
          <Card>
            <h2 className="font-display text-lg font-semibold">Pick a site</h2>
            <p className="mt-1 text-sm text-ink-2">
              Every dot is a OneAquaHealth research site where scientists sampled fish, invertebrates, diatoms and microbes. Switch layers to compare what the lab found with what people have heard there.
            </p>
          </Card>
        )}
      </aside>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
