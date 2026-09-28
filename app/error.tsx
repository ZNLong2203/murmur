"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/primitives";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="font-mono text-sm text-muted">Something went quiet</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">This page did not load</h1>
      <p className="mt-3 text-ink-2">Something went wrong while loading it. Try again, and if it keeps happening, start over from the home page.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href="/" className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:border-ink-2">
          Back to the start
        </Link>
      </div>
      {error.digest && <p className="mt-8 font-mono text-xs text-muted">Reference {error.digest}</p>}
    </main>
  );
}
