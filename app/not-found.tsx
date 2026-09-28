import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Nothing to hear here</h1>
      <p className="mt-3 text-ink-2">
        This page does not exist. If you followed a link to a stream site, its code may be wrong: the map lists all of them.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/map" className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-paper hover:bg-brand-ink">
          See the stream sites
        </Link>
        <Link href="/" className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:border-ink-2">
          Back to the start
        </Link>
      </div>
    </main>
  );
}
