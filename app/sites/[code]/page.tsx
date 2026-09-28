import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LabCard } from "@/components/analyze/LabCard";
import { Card, CardTitle, Chip } from "@/components/ui/primitives";
import { GROUPS, groupOf } from "@/lib/analysis/taxa";
import { STATUS_LABEL } from "@/lib/commons/consensus";
import { sessionsAt } from "@/lib/commons/repo";
import { rollupBySite } from "@/lib/commons/summary";
import { getDb } from "@/lib/db/client";
import { getLabSummary, getSite, getUrbanContext } from "@/lib/oah/data";

export async function generateMetadata({ params }: PageProps<"/sites/[code]">): Promise<Metadata> {
  const site = getSite((await params).code);
  return site ? { title: `${site.code} · ${site.name}, ${site.cityName}` } : { title: "Site not found" };
}

const TONE_COLOR = { good: "var(--ok)", caution: "var(--warn)", bad: "var(--bad)", neutral: undefined } as const;

export default async function SitePage({ params }: PageProps<"/sites/[code]">) {
  const { code } = await params;
  const site = getSite(code);
  if (!site) notFound();

  await connection();
  const sessions = await sessionsAt(await getDb(), code);
  const rollup = rollupBySite(sessions).get(code);
  const lab = getLabSummary(code);
  const urban = getUrbanContext(code);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/map" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
          Streams
        </Link>{" "}
        / {site.cityName} / {site.code}
      </nav>
      <header className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{site.name}</h1>
          <p className="mt-1 text-ink-2">
            OneAquaHealth research site {site.code}, {site.cityName} · {site.lat.toFixed(4)}, {site.lon.toFixed(4)}
          </p>
        </div>
        <Link href={`/analyze?site=${site.code}`} className="rounded-full bg-brand px-5 py-2.5 font-medium text-paper hover:bg-brand-ink">
          Add a recording here
        </Link>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardTitle hint="Calls people shared from recordings made here. Rejected calls are not shown.">What people heard here</CardTitle>
            {rollup && rollup.species.length > 0 ? (
              <ul className="divide-y divide-line">
                {rollup.species.map((s) => {
                  const group = groupOf({ className: s.className });
                  const status = STATUS_LABEL[s.best];
                  return (
                    <li key={s.labelIdx} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: GROUPS[group].color }} aria-hidden="true" />
                        <span className="font-medium">{s.en}</span>
                        {s.en !== s.sci && <span className="text-sm italic text-muted">{s.sci}</span>}
                      </span>
                      <span className="flex items-center gap-2 text-sm">
                        <Chip color={TONE_COLOR[status.tone]}>{status.label}</Chip>
                        <span className="font-mono text-xs text-muted">{s.maxP.toFixed(2)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-ink-2">
                Nobody has shared a recording from here yet.{" "}
                <Link href={`/analyze?site=${site.code}`} className="text-brand-ink underline underline-offset-2">
                  Be the first.
                </Link>
              </p>
            )}
          </Card>

          {sessions.length > 0 && (
            <Card>
              <CardTitle>Recordings shared</CardTitle>
              <ul className="space-y-3 text-sm">
                {sessions.map((s) => (
                  <li key={s.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{s.recordedOn}</span>
                      <span className="text-muted">
                        {s.attribution ? (
                          <>
                            Public recording by {s.attribution.recordist} ({s.attribution.license},{" "}
                            <a className="underline decoration-line-strong underline-offset-2" href={s.attribution.url} target="_blank" rel="noreferrer">
                              xeno-canto
                            </a>
                            )
                          </>
                        ) : (
                          "Shared by a Murmur contributor"
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-ink-2">
                      {s.detections.length} calls · NDSI {s.soundscape.ndsi.toFixed(2)} · clear enough to hear small birds {Math.round(s.soundscape.audibleShare * 100)}% of the time · birds or frogs {Math.round(s.soundscape.lifeShare * 100)}% of the time
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          {lab && <LabCard lab={lab} />}
          {urban && (
            <Card>
              <CardTitle hint="From the OneAquaHealth Resilience Map's urban parameters.">Pressures around the site</CardTitle>
              <dl className="space-y-2 text-sm">
                {[
                  ["Sealed ground within 500 m", urban.imperviousPct500m, "%"],
                  ["Vegetation within 100 m", urban.vegCoverPct100m, "%"],
                  ["Built-up land within 500 m", urban.urbanPct500m, "%"],
                ].map(([label, value, unit]) => (
                  <div key={label as string} className="flex justify-between gap-2">
                    <dt className="text-ink-2">{label}</dt>
                    <dd className="font-mono">{value == null ? "–" : `${Math.round(value as number)}${unit}`}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-2">Nearest sewage works</dt>
                  <dd className="font-mono">{urban.distanceToSewageStationM == null ? "–" : `${(urban.distanceToSewageStationM / 1000).toFixed(1)} km`}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">
                Across the 96 sites the labs sampled, pathogen risk was higher closer to sewage works (Spearman ρ = −0.35), a pattern Murmur found in the OneAquaHealth data.
              </p>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}
