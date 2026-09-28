import Link from "next/link";
import { HeroListening } from "@/components/home/HeroListening";
import { loadDemoRecordings } from "@/lib/content";
import { cities, sites } from "@/lib/oah/data";

const ONE_HEALTH = [
  {
    title: "Animals",
    color: "var(--bird)",
    body: "Birds and amphibians are two of OneAquaHealth's eleven indicators of stream health, and natural controls of mosquitoes and other disease carriers. Murmur names 11,560 kinds of calls, including 647 amphibians.",
  },
  {
    title: "Environment",
    color: "var(--water)",
    body: "Rushing water and traffic leave a measurable mark. Murmur reports the balance of natural and human sound, and how much of the recording was too loud to hear quiet calls, so silence is never read as absence.",
  },
  {
    title: "People",
    color: "var(--amphibian)",
    body: "Hearing birds lifts wellbeing for hours. The OneAquaHealth app already asks how a stream makes people feel; Murmur records what they actually heard.",
  },
];

const STEPS = [
  { n: "1", title: "Record anywhere", body: "A phone voice memo, a field recorder, or the 5–10 second video the OneAquaHealth app already asks for. No new hardware." },
  { n: "2", title: "Murmur listens on your device", body: "BirdNET runs in the browser, 3 seconds at a time. The recording is never uploaded." },
  { n: "3", title: "You confirm by ear", body: "Every call comes with the clip that triggered it. Yes, not sure, or no: the AI suggests, people decide." },
  { n: "4", title: "Compare and share", body: "See what the OneAquaHealth labs found at the same site, then export FHIR for health systems and Darwin Core for biodiversity databases." },
];

export default function Home() {
  const samples = loadDemoRecordings();
  const featured = samples.find((s) => (s.detections?.length ?? 0) >= 2) ?? samples[0];

  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-10 md:pt-16 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <p className="text-sm font-medium tracking-wide text-brand-ink">A stethoscope for urban streams</p>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Listen to a stream.
            <br />
            Hear its health.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-2">
            Murmur turns a short recording made at a city stream into a biodiversity, noise and wellbeing reading, confirmed by the people who were there, and sets it beside what the OneAquaHealth labs found in the water.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/analyze" className="rounded-full bg-brand px-5 py-3 font-medium text-paper hover:bg-brand-ink">
              Listen to a recording
            </Link>
            <Link href="/map" className="rounded-full border border-line-strong bg-card px-5 py-3 font-medium text-ink hover:border-ink-2">
              Explore the five cities
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">Free, open source, and private by design: analysis runs in your browser.</p>
        </div>
        {featured ? (
          <HeroListening sample={featured} />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-line bg-card text-muted">Sample recordings are being prepared.</div>
        )}
      </section>

      <section className="border-y border-line bg-paper-2/60">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="max-w-2xl font-display text-2xl font-semibold tracking-tight md:text-3xl">One recording, three kinds of health</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {ONE_HEALTH.map((c) => (
              <article key={c.title} className="rounded-2xl border border-line bg-card p-5" style={{ borderTop: `4px solid ${c.color}` }}>
                <h3 className="font-display text-lg font-semibold">{c.title}</h3>
                <p className="mt-2 text-ink-2">{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">How it works</h2>
        <ol className="mt-6 grid gap-5 md:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-2xl border border-line bg-card p-5">
              <span className="font-mono text-sm text-brand-ink">{s.n}</span>
              <h3 className="mt-1 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-4">
        <div className="grid gap-6 rounded-2xl border border-line bg-card p-6 md:grid-cols-[1.3fr_1fr] md:p-8">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">Built on OneAquaHealth, not beside it</h2>
            <p className="mt-3 text-ink-2">
              The OneAquaHealth citizen app already asks people to describe a stream and say how it made them feel, and its own research found that people keep contributing when they can see what their observations mean. Murmur adds a listening step to that journey: a biological indicator taken from sound, an answer on the spot, and a direct link to the project&apos;s research sites, lab results and FHIR data model.
            </p>
            <Link href="/evidence" className="mt-4 inline-block text-sm font-medium text-brand-ink underline decoration-line-strong underline-offset-4">
              How we checked it, and what it cannot do
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-4 self-center">
            {[
              [String(cities.length), "OneAquaHealth cities"],
              [String(sites.length), "research sites linked"],
              ["11,560", "species and sound classes"],
              ["0 bytes", "of audio uploaded to analyse"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-xl bg-paper-2 p-4">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="font-display text-3xl font-semibold tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
