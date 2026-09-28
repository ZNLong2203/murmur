import type { Metadata } from "next";
import { SnrChart } from "@/components/evidence/SnrChart";
import { Card, CardTitle } from "@/components/ui/primitives";
import { AUDIBILITY_THRESHOLD_DB, loadOahFindings, loadParity, loadSnrBenchmark } from "@/lib/content";
import { oahMeta } from "@/lib/oah/data";

export const metadata: Metadata = {
  title: "Evidence",
  description: "How Murmur was checked, what it cannot do, and what we noticed in OneAquaHealth's own data.",
};

const LIMITS = [
  ["It does not measure water quality.", "Sound tells you who is living by a stream, not what is in the water. That is why every site page shows the lab results beside what people heard."],
  ["It makes mistakes.", "BirdNET is a probabilistic model and confuses similar calls. Every suggestion comes with its 3-second clip and is checked by the recordist, then by other listeners and, when they disagree, by an expert."],
  ["Silence is not absence.", "Rushing water and traffic mask quiet calls. Murmur hatches the windows too noisy to judge and says so, instead of reporting nothing."],
  ["Range lists are regional.", "The geomodel says which species are plausible in a region and week, not at one stream. Unusual names are listed apart, not hidden."],
  ["It is not a replacement for expert surveys.", "It adds many cheap, repeatable, verifiable observations between the lab's visits; it does not replace them."],
  ["Phones are not calibrated.", "Indices are relative (NDSI, audibility), never absolute decibels, so recordings from different phones stay comparable."],
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function EvidencePage() {
  const snr = loadSnrBenchmark();
  const parity = loadParity();
  const oah = loadOahFindings();
  const shared = parity?.results.reduce((s, r) => s + r.shared, 0) ?? 0;
  const union = parity?.results.reduce((s, r) => s + r.browser + r.offline - r.shared, 0) ?? 0;
  const identical = parity?.results.filter((r) => r.jaccard === 1).length ?? 0;
  const diffs = parity?.results.flatMap((r) => (r.meanAbsScoreDiff == null ? [] : [r.meanAbsScoreDiff])) ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">How we checked Murmur, and what it cannot do</h1>
        <p className="mt-2 text-ink-2">Every number on this page is produced by a script in the repository and can be regenerated.</p>
      </header>

      <section aria-labelledby="limits" className="mt-8">
        <h2 id="limits" className="font-display text-2xl font-semibold tracking-tight">What Murmur is not</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {LIMITS.map(([title, body]) => (
            <Card key={title}>
              <h3 className="font-medium text-ink">{title}</h3>
              <p className="mt-1 text-sm text-ink-2">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="checks" className="mt-10 space-y-5">
        <h2 id="checks" className="font-display text-2xl font-semibold tracking-tight">Checks</h2>

        {snr?.bySnr && snr.bySnr.length > 0 && (
          <Card>
            <CardTitle hint={`${snr.nPositives ?? "?"} clean calls of ${snr.species?.length ?? "?"} stream-side species, each mixed with real recordings of flowing water at controlled loudness. scripts: pipeline/murmur_pipeline/benchmark.py`}>
              How rushing water hides birdsong
            </CardTitle>
            <SnrChart rows={snr.bySnr} />
            <p className="mt-3 text-sm text-ink-2">
              On a real recording Murmur cannot know the true signal-to-noise ratio, so it uses the audibility index measured from the sound itself.
              {snr.byAudibility && (
                <>
                  {" "}Below {AUDIBILITY_THRESHOLD_DB} dB the benchmark detected only{" "}
                  {pct(Math.min(...snr.byAudibility.filter((b) => b.hi != null && b.hi <= AUDIBILITY_THRESHOLD_DB).map((b) => b.recall03)))}–
                  {pct(Math.max(...snr.byAudibility.filter((b) => b.hi != null && b.hi <= AUDIBILITY_THRESHOLD_DB).map((b) => b.recall03)))} of calls, against{" "}
                  {pct(Math.min(...snr.byAudibility.filter((b) => b.lo != null && b.lo >= AUDIBILITY_THRESHOLD_DB).map((b) => b.recall03)))}–
                  {pct(Math.max(...snr.byAudibility.filter((b) => b.lo != null && b.lo >= AUDIBILITY_THRESHOLD_DB).map((b) => b.recall03)))} above it, so those windows are hatched as hard to hear.
                </>
              )}
              {snr.falsePositiveRate03 != null && ` On water noise alone, the model named a plausible species in ${pct(snr.falsePositiveRate03)} of windows at score ≥ 0.3.`}
            </p>
          </Card>
        )}

        {parity && (
          <Card>
            <CardTitle hint="scripts/parity-check.mjs drives the real page in headless Chrome.">The browser hears what the reference run hears</CardTitle>
            <p className="text-sm text-ink-2">
              Across the {parity.recordings} public recordings, the model running in the browser (Web Audio resampling, onnxruntime-web) and the reference run (ffmpeg, onnxruntime on CPU) agreed on{" "}
              <strong className="text-ink">
                {shared} of {union} species–recording pairs
              </strong>{" "}
              (Jaccard {parity.pooledJaccard.toFixed(2)}), with identical species lists for {identical} recordings. Where both heard a species, scores differed by {diffs.length ? `${Math.min(...diffs).toFixed(2)}–${Math.max(...diffs).toFixed(2)}` : "–"} on average. The disagreements are calls close to the 0.25 threshold, where resampling differences decide which side they fall.
            </p>
          </Card>
        )}

        <Card>
          <CardTitle hint="lib/privacy/speech.ts · Silero VAD v5.1.2 (MIT)">Voices never leave the device</CardTitle>
          <p className="text-sm text-ink-2">
            Speech is a run of at least 8 consecutive 32 ms frames (250 ms) above 0.5 probability. In our check, synthetic speech ran for 74 frames and was muted, while a White-throated Dipper&apos;s call never exceeded 3 frames and was kept. A clip that is mostly talking is not shared at all; in the end-to-end test, a clip with a voice over the dipper stayed on the device.
          </p>
        </Card>

        <Card>
          <CardTitle hint="scripts/validate-fhir.mts">FHIR that a real server accepts</CardTitle>
          <p className="text-sm text-ink-2">
            A representative bundle validated on the public HAPI FHIR R4 server with no structural errors. The only errors say that the OneAquaHealth profiles are not loaded on that server, which is expected; the remaining warnings concern code systems that server does not know (the OAH temporary system, GBIF, and Murmur&apos;s own, which is published at <code className="font-mono text-xs">/fhir/CodeSystem/murmur</code>).
          </p>
        </Card>

        <Card>
          <CardTitle hint="npm test">Tested logic</CardTitle>
          <p className="text-sm text-ink-2">
            Unit and integration tests cover the FFT and acoustic indices, windowing and detection merging, the range filter, the soundscape summary, speech muting, the WAV encoder, FHIR and Darwin Core exports, consensus rules, and the commons repository on a real in-process Postgres (PGlite).
          </p>
        </Card>
      </section>

      {oah && (
        <section aria-labelledby="oah" className="mt-10">
          <h2 id="oah" className="font-display text-2xl font-semibold tracking-tight">What we noticed in OneAquaHealth&apos;s own data</h2>
          <div className="mt-4 grid gap-5 md:grid-cols-[1fr_1.4fr]">
            <Card>
              <p className="text-sm text-muted">Lab samples taken after three dry days</p>
              <p className="font-display text-5xl font-semibold tracking-tight">
                {oah.sampledAfterThreeDryDays} of {oah.samples}
              </p>
              <p className="mt-2 text-sm text-ink-2">
                Dry means {oah.dryDefinition} (ERA5 reanalysis). Microbial risk in urban streams peaks after rain, when sewers overflow, and one visit per site cannot catch it. Recordings can be made any day, including the morning after a storm, so a network of listeners fills the gaps between lab visits.
              </p>
            </Card>
            <Card>
              <CardTitle hint={oah.note}>Associations across the {oah.samples} samples (Spearman ρ)</CardTitle>
              <ul className="divide-y divide-line text-sm">
                {oah.correlations.map((c) => (
                  <li key={c.what} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-ink-2">{c.what}</span>
                    <span className="font-mono text-ink">{c.rho > 0 ? "+" : ""}{c.rho.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </section>
      )}

      <section aria-labelledby="data" className="mt-10">
        <h2 id="data" className="font-display text-2xl font-semibold tracking-tight">Data, models and licences</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Source</th>
                <th className="px-4 py-2 font-normal">Used for</th>
                <th className="px-4 py-2 font-normal">Licence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[
                ["BirdNET+ V3.0 developer preview 3.1 (Kahl et al.), Zenodo 20703646", "Species identification in the browser", "CC BY-SA 4.0; no poaching or military use"],
                ["BirdNET+ geomodel V3.0.4", "Species plausible per place and week", "CC BY-SA 4.0"],
                ["Silero VAD v5.1.2", "Finding speech in shared clips", "MIT"],
                [`OneAquaHealth public API, snapshot ${oahMeta.fetchedAt.slice(0, 10)}`, "Sites, ecology classes, health risks, urban context", "© OneAquaHealth consortium"],
                ["xeno-canto recordings via GBIF (credited per file)", "Demo recordings and benchmark calls", "CC BY-NC-SA 4.0 and compatible"],
                ["GBIF Backbone Taxonomy", "Taxon identifiers in exports", "CC BY 4.0"],
                ["ERA5 via the Open-Meteo archive API", "Rain before lab sampling", "CC BY 4.0"],
                ["OpenFreeMap, OpenMapTiles, OpenStreetMap", "Base map", "ODbL and open terms"],
              ].map(([source, use, licence]) => (
                <tr key={source}>
                  <td className="px-4 py-2 text-ink">{source}</td>
                  <td className="px-4 py-2 text-ink-2">{use}</td>
                  <td className="px-4 py-2 text-ink-2">{licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
