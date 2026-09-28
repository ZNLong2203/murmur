import "server-only";
import BE from "@/data/range/BE.json";
import CO from "@/data/range/CO.json";
import GH from "@/data/range/GH.json";
import HN from "@/data/range/HN.json";
import OS from "@/data/range/OS.json";
import SG from "@/data/range/SG.json";
import TO from "@/data/range/TO.json";
import { nearest } from "./geo";

// Species the BirdNET geomodel expects at each location and week
// (precomputed by pipeline/murmur_pipeline/ranges.py). Detections of
// species outside the list are shown separately, never silently kept.

interface RangeFile {
  id: string;
  name: string;
  lat: number;
  lon: number;
  model: string;
  threshold: number;
  weeks: Record<string, number[]>;
  yearRound: number[];
}

const LOCATIONS = [CO, TO, GH, BE, OS, HN, SG] as RangeFile[];

/** Range lists are regional; beyond this distance we do not apply one. */
export const MAX_RANGE_KM = 300;

export interface RangeAnswer {
  location: { id: string; name: string; distanceKm: number; model: string } | null;
  week: number;
  allowed: number[] | null;
}

export function rangeFor(lat: number, lon: number, week: number): RangeAnswer {
  const hit = nearest({ lat, lon }, LOCATIONS);
  if (!hit || hit.km > MAX_RANGE_KM) return { location: null, week, allowed: null };
  const { item, km } = hit;
  return {
    location: { id: item.id, name: item.name, distanceKm: Math.round(km), model: item.model },
    week,
    allowed: item.weeks[String(week)] ?? item.yearRound,
  };
}
