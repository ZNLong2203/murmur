import type { Place } from "@/lib/analysis/session";
import { formatTime } from "@/lib/analysis/taxa";
import type { Label, SpeciesSummary } from "@/lib/analysis/types";
import { VERIFICATION_DISPLAY, type Verification } from "./fhir";

// Darwin Core occurrences (one row per species heard) so a session can go
// to GBIF or a national biodiversity portal as well as to a FHIR server.

export const DWC_COLUMNS = [
  "occurrenceID",
  "basisOfRecord",
  "eventDate",
  "decimalLatitude",
  "decimalLongitude",
  "coordinateUncertaintyInMeters",
  "locationID",
  "locality",
  "scientificName",
  "vernacularName",
  "taxonID",
  "kingdom",
  "class",
  "occurrenceStatus",
  "identifiedBy",
  "identificationVerificationStatus",
  "identificationRemarks",
  "samplingProtocol",
  "recordedBy",
  "license",
  "datasetName",
] as const;

export interface DwcInput {
  sessionId: string;
  place: Place | null;
  recordedAt: string;
  contributor: string;
  species: SpeciesSummary[];
  verification: Record<number, Verification>;
  labels: Label[];
  gbif: Record<number, { key: number; kingdom?: string; class?: string }>;
  modelName: string;
  samplingProtocol: string;
}

function cell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildDwcCsv(input: DwcInput): string {
  const lat = input.place?.kind === "site" ? input.place.site.lat : input.place?.kind === "point" ? input.place.lat : null;
  const lon = input.place?.kind === "site" ? input.place.site.lon : input.place?.kind === "point" ? input.place.lon : null;
  const rows = input.species.map((s) => {
    const label = input.labels[s.labelIdx];
    const g = input.gbif[s.labelIdx];
    const status = input.verification[s.labelIdx] ?? "ai-suggested";
    const row: Record<(typeof DWC_COLUMNS)[number], string | number | null> = {
      occurrenceID: `urn:murmur:${input.sessionId}:${s.labelIdx}`,
      basisOfRecord: "MachineObservation",
      eventDate: input.recordedAt,
      decimalLatitude: lat,
      decimalLongitude: lon,
      coordinateUncertaintyInMeters: input.place?.kind === "site" ? 100 : input.place ? 1000 : null,
      locationID: input.place?.kind === "site" ? `https://api.enora-oah.eu/api/sites/${input.place.site.code}` : null,
      locality: input.place?.kind === "site" ? `${input.place.site.name}, ${input.place.site.cityName}` : input.place?.kind === "point" ? input.place.label : null,
      scientificName: label.sci,
      vernacularName: label.en,
      taxonID: g ? `https://www.gbif.org/species/${g.key}` : null,
      kingdom: g?.kingdom ?? "Animalia",
      class: g?.class ?? label.className,
      occurrenceStatus: "present",
      identifiedBy: status === "confirmed-by-recordist" ? `${input.modelName}; confirmed by ear by the recordist` : input.modelName,
      identificationVerificationStatus: VERIFICATION_DISPLAY[status],
      identificationRemarks: `model score ${s.maxP.toFixed(2)}; heard at ${s.detections.map((d) => `${formatTime(d.startS)}-${formatTime(d.endS)}`).join(", ")}`,
      samplingProtocol: input.samplingProtocol,
      recordedBy: input.contributor,
      license: "http://creativecommons.org/licenses/by/4.0/legalcode",
      datasetName: "Murmur acoustic observations of urban streams",
    };
    return DWC_COLUMNS.map((c) => cell(row[c])).join(",");
  });
  return [DWC_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}
