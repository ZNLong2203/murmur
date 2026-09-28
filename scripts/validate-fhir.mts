// Build a representative Murmur bundle and ask a real FHIR R4 server to
// validate it ($validate). Usage: npx tsx scripts/validate-fhir.mts [baseUrl]
// Default server: the public HAPI FHIR R4 test server. It checks base R4
// conformance; OneAquaHealth IG profiles are declared but not loaded there.

import type { OperationOutcome } from "fhir/r4";
import { buildFhirBundle } from "../lib/interop/fhir";

const base = process.argv[2] ?? "https://hapi.fhir.org/baseR4";

const bundle = buildFhirBundle({
  sessionId: "4f1c2a9e-7d3b-4c1a-9e2f-000000000000",
  place: { kind: "site", site: { code: "C10", name: "Arregaça", cityId: "CO", cityName: "Coimbra", lat: 40.19, lon: -8.41, altitude: 30 } },
  recordedAt: "2026-04-06",
  contributor: "anon-7Q2K",
  species: [{ labelIdx: 0, maxP: 0.634, windows: 1, detections: [{ labelIdx: 0, startS: 0, endS: 3, maxP: 0.634, bestWindow: 0 }] }],
  verification: { 0: "confirmed-by-recordist" },
  labels: [{ idx: 0, sci: "Cinclus cinclus", en: "White-throated Dipper", className: "Aves", order: "Passeriformes", names: {} }],
  gbif: { 0: { key: 2492468 } },
  soundscape: { windows: 1, audibleShare: 1, ndsi: 0.95, ndsiWords: "Mostly nature", lifeShare: 1, byGroup: { bird: 1, amphibian: 0, insect: 0, mammal: 0, other: 0 }, indicators: [], insectEaters: 0, nonNative: 0 },
  model: { id: "birdnet-v3.0-p3.1-fp16-pruned", name: "BirdNET+ V3.0 developer preview 3.1", version: "3.0-preview3.1", license: "CC BY-SA 4.0" },
  method: "Passive acoustic recording; BirdNET 3 s windows, threshold 0.25, geomodel range filter",
  audioSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
});

const res = await fetch(`${base}/Bundle/$validate`, {
  method: "POST",
  headers: { "content-type": "application/fhir+json", accept: "application/fhir+json" },
  body: JSON.stringify(bundle),
});
const outcome = (await res.json()) as OperationOutcome;
const issues = outcome.issue ?? [];
const count = (sev: string) => issues.filter((i) => i.severity === sev).length;
console.log(`HTTP ${res.status} · ${base}`);
console.log(`errors ${count("error") + count("fatal")} · warnings ${count("warning")} · info ${count("information")}`);
for (const i of issues.filter((x) => x.severity !== "information").slice(0, 25)) {
  console.log(`- [${i.severity}] ${i.expression?.[0] ?? i.location?.[0] ?? ""}: ${i.diagnostics?.slice(0, 220)}`);
}
process.exitCode = count("error") + count("fatal") > 0 ? 1 : 0;
