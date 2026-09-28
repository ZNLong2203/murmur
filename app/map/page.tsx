import type { Metadata } from "next";
import { connection } from "next/server";
import { StreamsMap, type MapSite } from "@/components/map/StreamsMap";
import { sessionsAt } from "@/lib/commons/repo";
import { rollupBySite } from "@/lib/commons/summary";
import { getDb } from "@/lib/db/client";
import { getLabSummary, sites } from "@/lib/oah/data";

export const metadata: Metadata = {
  title: "Streams",
  description: "The 106 OneAquaHealth research sites: what the lab found, and what people have heard there.",
};

export default async function MapPage() {
  await connection(); // the commons changes with every shared recording
  const rollup = rollupBySite(await sessionsAt(await getDb(), null));

  const mapSites: MapSite[] = sites.map((s) => {
    const lab = getLabSummary(s.code);
    const heard = rollup.get(s.code);
    return {
      code: s.code,
      name: s.name,
      cityId: s.cityId,
      cityName: s.cityName,
      lat: s.lat,
      lon: s.lon,
      risk: lab?.risk?.healthRiskScore ?? null,
      riskDate: lab?.risk?.samplingDate ?? null,
      sessions: heard?.sessions ?? 0,
      heard: heard?.species.length ?? 0,
      trusted: heard?.trusted ?? 0,
      topSpecies: (heard?.species ?? []).slice(0, 8).map((sp) => ({ en: sp.en, status: sp.best })),
    };
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Five cities, {sites.length} stream sites</h1>
        <p className="mt-2 text-ink-2">
          OneAquaHealth scientists sampled these urban streams in Coimbra, Benevento, Ghent, Oslo and Toulouse. Murmur adds what people hear there, confirmed by ear, next to what the lab found in the water.
        </p>
      </header>
      <StreamsMap sites={mapSites} />
    </main>
  );
}
