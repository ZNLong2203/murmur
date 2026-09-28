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
  lat: number | null;
  lon: number | null;
  recordedAt: string | null;
  cityId: string | null;
  kind?: "soundscape" | "amphibian" | "video";
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

/** Where a public sample belongs: its research site if within 3 km, its own point, or unknown. */
export function samplePlace(sample: DemoRecording, sites: OahSite[]): Place | null {
  const site = sites.find((s) => s.code === sample.nearestSiteCode);
  if (site && (sample.nearestSiteDistanceKm ?? 99) <= 3) return { kind: "site", site };
  if (sample.lat == null || sample.lon == null) return null;
  return { kind: "point", lat: sample.lat, lon: sample.lon, label: sample.title };
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
