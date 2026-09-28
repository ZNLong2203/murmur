import type { Bundle, BundleEntry, Device, Location, Observation, ObservationComponent, Provenance, Reference } from "fhir/r4";
import type { Place } from "@/lib/analysis/session";
import type { SoundscapeSummary } from "@/lib/analysis/soundscape";
import { groupOf, type SoundGroup } from "@/lib/analysis/taxa";
import { SITE_URL } from "@/lib/site";
import type { Label, SpeciesSummary } from "@/lib/analysis/types";

// One Murmur session as a FHIR R4 transaction Bundle, shaped by the
// OneAquaHealth FHIR IG (http://hl7.eu/fhir/ig/oah): the site is a
// LocationOah, birds and amphibians are ObservationIndicatorsOah coded with
// the IG's own concepts, and a Provenance says what the AI suggested and
// what a person confirmed. The recording itself is named only by its hash.

export const OAH_IG = "http://hl7.eu/fhir/ig/oah";
export const OAH_CS = `${OAH_IG}/CodeSystem/temporarySystem-oah-eu`;
export const MURMUR_CS = `${SITE_URL}/fhir/CodeSystem/murmur`;
export const OAH_SITE_ID = "https://api.enora-oah.eu/api/sites";
const UCUM = "http://unitsofmeasure.org";

export type Verification = "ai-suggested" | "confirmed-by-recordist" | "uncertain-by-recordist";

export const VERIFICATION_DISPLAY: Record<Verification, string> = {
  "ai-suggested": "Suggested by the model, not yet checked by a person",
  "confirmed-by-recordist": "Confirmed by ear by the person who recorded it",
  "uncertain-by-recordist": "The recordist could not confirm it by ear",
};

export interface FhirExportInput {
  sessionId: string;
  place: Place | null;
  /** ISO date (YYYY-MM-DD) or date-time of the recording. */
  recordedAt: string;
  contributor: string;
  species: SpeciesSummary[];
  verification: Record<number, Verification>;
  labels: Label[];
  gbif: Record<number, { key: number }>;
  soundscape: SoundscapeSummary;
  model: { id: string; name: string; version: string; license: string };
  method: string;
  audioSha256: string | null;
  now?: string;
}

const OAH_GROUP_CODE: Partial<Record<SoundGroup, { code: string; display: string }>> = {
  bird: { code: "birds", display: "Birds" },
  amphibian: { code: "amphibians", display: "Amphibians" },
};

/** 12 hex digits from FNV-1a, to derive one valid UUID per resource from the session UUID. */
function hex12(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of text) h = BigInt.asUintN(64, (h ^ BigInt(ch.codePointAt(0)!)) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0").slice(-12);
}

const urn = (sessionId: string, name: string) => `urn:uuid:${sessionId.slice(0, 24)}${hex12(name)}`;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Human-readable narrative (dom-6): one short paragraph per resource. */
function narrative(text: string) {
  return { status: "generated" as const, div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeXml(text)}</p></div>` };
}

function contributorRef(contributor: string): Reference {
  return { identifier: { system: `${SITE_URL}/fhir/contributor`, value: contributor }, display: "Murmur contributor (pseudonymous citizen scientist)" };
}

/** RFC 6920 "ni" name for a SHA-256 digest given in hex. */
export function niSha256(hex: string): string {
  const bytes = hex.match(/../g)!.map((h) => parseInt(h, 16));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `ni:///sha-256;${b64}`;
}

function location(place: Place | null): { resource: Location; ifNoneExist: string } {
  if (place?.kind === "site") {
    const { site } = place;
    return {
      ifNoneExist: `identifier=${OAH_SITE_ID}|${site.code}`,
      resource: {
        resourceType: "Location",
        meta: { profile: [`${OAH_IG}/StructureDefinition/location-oah`] },
        identifier: [{ system: OAH_SITE_ID, value: site.code }],
        text: narrative(`OneAquaHealth research site ${site.code}, ${site.name} (${site.cityName}), on an urban stream.`),
        name: `${site.name} (${site.code}), ${site.cityName}`,
        mode: "instance",
        position: { latitude: site.lat, longitude: site.lon, ...(site.altitude != null ? { altitude: site.altitude } : {}) },
      },
    };
  }
  const lat = place?.kind === "point" ? place.lat : 0;
  const lon = place?.kind === "point" ? place.lon : 0;
  const value = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  return {
    ifNoneExist: `identifier=${SITE_URL}/fhir/place|${value}`,
    resource: {
      resourceType: "Location",
      meta: { profile: [`${OAH_IG}/StructureDefinition/location-oah`] },
      text: narrative(`Recording place ${value}.`),
      identifier: [{ system: `${SITE_URL}/fhir/place`, value }],
      name: place?.kind === "point" ? place.label : "Unspecified place",
      mode: "instance",
      ...(place?.kind === "point" ? { position: { latitude: lat, longitude: lon } } : {}),
    },
  };
}

function device(model: FhirExportInput["model"]): Device {
  return {
    resourceType: "Device",
    text: narrative(`${model.name} (${model.version}), an acoustic species classifier run in the contributor's browser.`),
    identifier: [{ system: `${SITE_URL}/fhir/model`, value: model.id }],
    deviceName: [{ name: model.name, type: "model-name" }],
    version: [{ value: model.version }],
    manufacturer: "K. Lisa Yang Center for Conservation Bioacoustics (Cornell) and Chemnitz University of Technology (BirdNET)",
    type: { text: "Acoustic species classifier (software), run on the contributor's device" },
    note: [{ text: `Licence ${model.license}. Powered by BirdNET (Kahl et al. 2021).` }],
  };
}

export function buildFhirBundle(input: FhirExportInput): Bundle {
  const now = input.now ?? new Date().toISOString();
  const loc = location(input.place);
  const locUrn = urn(input.sessionId, "location");
  const devUrn = urn(input.sessionId, "device");
  const subject: Reference = { reference: locUrn, display: loc.resource.name };
  const performer = [contributorRef(input.contributor)];
  const entries: BundleEntry[] = [
    { fullUrl: locUrn, resource: loc.resource, request: { method: "POST", url: "Location", ifNoneExist: loc.ifNoneExist } },
    {
      fullUrl: devUrn,
      resource: device(input.model),
      request: { method: "POST", url: "Device", ifNoneExist: `identifier=${SITE_URL}/fhir/model|${input.model.id}` },
    },
  ];

  const observationUrns: string[] = [];
  const byGroup = new Map<SoundGroup, SpeciesSummary[]>();
  for (const s of input.species) {
    const g = groupOf(input.labels[s.labelIdx]);
    byGroup.set(g, [...(byGroup.get(g) ?? []), s]);
  }

  for (const [group, list] of byGroup) {
    const oah = OAH_GROUP_CODE[group];
    const components: ObservationComponent[] = list.map((s) => {
      const label = input.labels[s.labelIdx];
      const key = input.gbif[s.labelIdx]?.key;
      const status = input.verification[s.labelIdx] ?? "ai-suggested";
      return {
        code: {
          coding: key ? [{ system: "https://www.gbif.org/species", code: String(key), display: label.sci }] : [],
          text: `${label.sci} (${label.en})`,
        },
        valueQuantity: { value: Math.round(s.maxP * 1000) / 1000, unit: "model score", system: UCUM, code: "1" },
        interpretation: [
          {
            coding: [
              { system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", code: "POS", display: "Positive" },
              { system: MURMUR_CS, code: status, display: VERIFICATION_DISPLAY[status] },
            ],
            text: VERIFICATION_DISPLAY[status],
          },
        ],
      };
    });
    const obsUrn = urn(input.sessionId, `obs-${group}`);
    observationUrns.push(obsUrn);
    const confirmed = list.filter((s) => input.verification[s.labelIdx] === "confirmed-by-recordist").length;
    const obs: Observation = {
      resourceType: "Observation",
      ...(oah ? { meta: { profile: [`${OAH_IG}/StructureDefinition/observation-indicators-oah`] } } : {}),
      text: narrative(
        `${list.length} ${group} species heard: ${list.map((s) => input.labels[s.labelIdx].sci).join(", ")}. ${confirmed} confirmed by ear by the recordist.`,
      ),
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey", display: "Survey" }] }],
      code: oah
        ? { coding: [{ system: OAH_CS, code: oah.code, display: oah.display }], text: `${oah.display} heard (passive acoustic survey)` }
        : { coding: [{ system: MURMUR_CS, code: `acoustic-${group}`, display: `${group} heard` }], text: `${group} heard (passive acoustic survey)` },
      subject,
      effectiveDateTime: input.recordedAt,
      issued: now,
      performer,
      valueQuantity: { value: list.length, unit: "species", system: UCUM, code: "1" },
      method: { text: input.method },
      device: { reference: devUrn, display: input.model.name },
      note: [{ text: `${list.length} species suggested by the model, ${confirmed} confirmed by ear by the recordist. Suggestions the recordist rejected are not included.` }],
      component: components,
    };
    entries.push({ fullUrl: obsUrn, resource: obs, request: { method: "POST", url: "Observation" } });
  }

  const s = input.soundscape;
  const soundUrn = urn(input.sessionId, "obs-sound");
  observationUrns.push(soundUrn);
  const percent = (v: number) => ({ value: Math.round(v * 1000) / 10, unit: "%", system: UCUM, code: "%" });
  const soundscape: Observation = {
      resourceType: "Observation",
      text: narrative(
        `Soundscape: NDSI ${s.ndsi.toFixed(2)}; ${Math.round(s.audibleShare * 100)}% of the time clear enough to hear small birds; birds or amphibians calling ${Math.round(s.lifeShare * 100)}% of the time.`,
      ),
      status: "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey", display: "Survey" }] }],
      code: { coding: [{ system: MURMUR_CS, code: "soundscape-indices", display: "Soundscape acoustic indices" }], text: "Soundscape acoustic indices" },
      subject,
      effectiveDateTime: input.recordedAt,
      issued: now,
      performer,
      method: { text: "Computed from the recording's spectrum (n_fft 1024, hop 512, Hann) in the contributor's browser." },
      component: [
        { code: { coding: [{ system: MURMUR_CS, code: "ndsi", display: "Normalized Difference Soundscape Index (Kasten et al. 2012)" }] }, valueQuantity: { value: Math.round(s.ndsi * 1000) / 1000, unit: "index", system: UCUM, code: "1" } },
        { code: { coding: [{ system: MURMUR_CS, code: "audible-share", display: "Share of 3 s windows clear enough to hear small birds" }] }, valueQuantity: percent(s.audibleShare) },
        { code: { coding: [{ system: MURMUR_CS, code: "life-share", display: "Share of 3 s windows with a bird or amphibian call" }] }, valueQuantity: percent(s.lifeShare) },
      ],
  };
  entries.push({ fullUrl: soundUrn, resource: soundscape, request: { method: "POST", url: "Observation" } });

  const provenance: Provenance = {
    resourceType: "Provenance",
    text: narrative("Species suggested by the BirdNET model (assembler) and checked by ear by the recordist (author and verifier)."),
    target: observationUrns.map((reference) => ({ reference })),
    recorded: now,
    activity: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-DataOperation", code: "CREATE", display: "create" }] },
    agent: [
      { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "author", display: "Author" }] }, who: contributorRef(input.contributor) },
      { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "assembler", display: "Assembler" }] }, who: { reference: devUrn, display: input.model.name } },
      { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "verifier", display: "Verifier" }] }, who: contributorRef(input.contributor) },
    ],
    ...(input.audioSha256
      ? { entity: [{ role: "source" as const, what: { identifier: { system: "urn:ietf:rfc:6920", value: niSha256(input.audioSha256) }, display: "Original recording, kept on the contributor's device" } }] }
      : {}),
  };
  entries.push({ fullUrl: urn(input.sessionId, "provenance"), resource: provenance, request: { method: "POST", url: "Provenance" } });

  return { resourceType: "Bundle", type: "transaction", timestamp: now, entry: entries };
}
