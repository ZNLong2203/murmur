import { describe, expect, it } from "vitest";
import type { Observation, Provenance } from "fhir/r4";
import type { SoundscapeSummary } from "@/lib/analysis/soundscape";
import type { Label, SpeciesSummary } from "@/lib/analysis/types";
import type { OahSite } from "@/lib/oah/types";
import { DWC_COLUMNS, buildDwcCsv } from "./dwc";
import { OAH_CS, buildFhirBundle, niSha256 } from "./fhir";

const site: OahSite = { code: "C10", name: "Arregaça", cityId: "CO", cityName: "Coimbra", lat: 40.19, lon: -8.41, altitude: 30 };
const labels: Label[] = [
  { idx: 0, sci: "Cinclus cinclus", en: "White-throated Dipper", className: "Aves", order: "Passeriformes", names: {} },
  { idx: 1, sci: "Hyla molleri", en: "Iberian Tree Frog", className: "Amphibia", order: "Anura", names: {} },
];
const species: SpeciesSummary[] = [
  { labelIdx: 0, maxP: 0.634, windows: 1, detections: [{ labelIdx: 0, startS: 0, endS: 3, maxP: 0.634, bestWindow: 0 }] },
  { labelIdx: 1, maxP: 0.41, windows: 2, detections: [{ labelIdx: 1, startS: 3, endS: 9, maxP: 0.41, bestWindow: 2 }] },
];
const soundscape: SoundscapeSummary = {
  windows: 3, audibleShare: 2 / 3, ndsi: 0.42, ndsiWords: "Mixed, nature ahead", lifeShare: 1,
  byGroup: { bird: 1, amphibian: 1, insect: 0, mammal: 0, other: 0 }, indicators: [], insectEaters: 0, nonNative: 0,
};
const base = {
  sessionId: "4f1c2a9e-7d3b-4c1a-9e2f-000000000000",
  place: { kind: "site" as const, site },
  recordedAt: "2026-04-06",
  contributor: "anon-7Q2K",
  species,
  verification: { 0: "confirmed-by-recordist" as const, 1: "uncertain-by-recordist" as const },
  labels,
  gbif: { 0: { key: 2492468, kingdom: "Animalia", class: "Aves" } },
};

describe("buildFhirBundle", () => {
  const bundle = buildFhirBundle({
    ...base,
    soundscape,
    model: { id: "birdnet-v3.0-p3.1-fp16-pruned", name: "BirdNET+ V3.0 preview 3.1", version: "3.0-preview3.1", license: "CC BY-SA 4.0" },
    method: "BirdNET 3 s windows",
    audioSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    now: "2026-09-29T10:00:00Z",
  });
  const resources = bundle.entry!.map((e) => e.resource!);

  it("is a transaction whose every fullUrl is a valid urn:uuid", () => {
    expect(bundle.type).toBe("transaction");
    for (const e of bundle.entry!) expect(e.fullUrl).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Set(bundle.entry!.map((e) => e.fullUrl)).size).toBe(bundle.entry!.length);
  });

  it("identifies the site the OneAquaHealth way and does not duplicate it", () => {
    const loc = bundle.entry![0];
    expect(loc.resource).toMatchObject({ resourceType: "Location", mode: "instance", identifier: [{ value: "C10" }] });
    expect(loc.request?.ifNoneExist).toContain("C10");
  });

  it("codes birds and amphibians with the OneAquaHealth IG concepts and GBIF taxa", () => {
    const obs = resources.filter((r): r is Observation => r.resourceType === "Observation");
    const birds = obs.find((o) => o.code.coding?.[0].code === "birds")!;
    expect(birds.code.coding![0].system).toBe(OAH_CS);
    expect(birds.meta?.profile?.[0]).toContain("observation-indicators-oah");
    expect(birds.component![0].code.coding![0]).toMatchObject({ system: "https://www.gbif.org/species", code: "2492468" });
    const status = (o: Observation) => o.component![0].interpretation![0].coding!.find((c) => c.system !== "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation")!.code;
    expect(birds.component![0].interpretation![0].coding![0].code).toBe("POS");
    expect(status(birds)).toBe("confirmed-by-recordist");
    expect(status(obs.find((o) => o.code.coding?.[0].code === "amphibians")!)).toBe("uncertain-by-recordist");
    expect(obs.find((o) => o.code.coding?.[0].code === "soundscape-indices")).toBeTruthy();
  });

  it("records who suggested and who confirmed, and names the recording by hash only", () => {
    const prov = resources.find((r): r is Provenance => r.resourceType === "Provenance")!;
    expect(prov.target).toHaveLength(3);
    expect(prov.agent.map((a) => a.type!.coding![0].code)).toEqual(["author", "assembler", "verifier"]);
    expect(prov.entity![0].what.identifier!.value).toBe("ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  });
});

describe("niSha256", () => {
  it("encodes a digest as an RFC 6920 name", () => {
    expect(niSha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe("ni:///sha-256;47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  });
});

describe("buildDwcCsv", () => {
  const csv = buildDwcCsv({ ...base, modelName: "BirdNET+ V3.0 preview 3.1", samplingProtocol: "passive acoustic, 3 s windows" });
  const lines = csv.trim().split("\r\n");

  it("writes the Darwin Core header and one row per species", () => {
    expect(lines[0].split(",")).toEqual([...DWC_COLUMNS]);
    expect(lines).toHaveLength(3);
  });

  it("quotes fields containing commas and links taxa to GBIF", () => {
    expect(lines[1]).toContain('"Arregaça, Coimbra"');
    expect(lines[1]).toContain("https://www.gbif.org/species/2492468");
    expect(lines[1]).toContain("MachineObservation");
  });
});
