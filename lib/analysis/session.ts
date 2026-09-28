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
}

export type Place =
  | { kind: "site"; site: OahSite }
  | { kind: "point"; lat: number; lon: number; label: string };

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
