import type { LabSummary, OahSite } from "@/lib/oah/types";

/** A public recording the pipeline prepared (data/demo/recordings.json). */
export interface DemoRecording {
  id: string;
  file: string;
  title: string;
  recordist: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  lat: number;
  lon: number;
  recordedAt: string | null;
  cityId: string;
  nearestSiteCode: string | null;
  nearestSiteDistanceKm: number | null;
  durationS: number;
  trimmed: boolean;
  notes?: string;
  /** Offline analysis (same model, range filter, threshold 0.25). */
  detections?: Array<{ labelIdx: number; sci: string; en: string; startS: number; endS: number; maxP: number }>;
}

export type Place =
  | { kind: "site"; site: OahSite }
  | { kind: "point"; lat: number; lon: number; label: string };

/** Where a public sample belongs: its research site if within 3 km, otherwise its own point. */
export function samplePlace(sample: DemoRecording, sites: OahSite[]): Place {
  const site = sites.find((s) => s.code === sample.nearestSiteCode);
  return site && (sample.nearestSiteDistanceKm ?? 99) <= 3
    ? { kind: "site", site }
    : { kind: "point", lat: sample.lat, lon: sample.lon, label: sample.title };
}

export function placeLatLon(place: Place): { lat: number; lon: number } {
  return place.kind === "site" ? { lat: place.site.lat, lon: place.site.lon } : { lat: place.lat, lon: place.lon };
}

export function placeLabel(place: Place): string {
  return place.kind === "site" ? `${place.site.code} · ${place.site.name}, ${place.site.cityName}` : place.label;
}

export interface WorkbenchData {
  sites: OahSite[];
  samples: DemoRecording[];
  labs: Record<string, LabSummary>;
  audibilityThresholdDb: number;
}
