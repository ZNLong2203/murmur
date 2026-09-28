import { Card, Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p role="status" className="sr-only">
        Loading the site…
      </p>
      <Skeleton className="h-4 w-48" />
      <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="w-full max-w-xl space-y-3">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-11 w-48 rounded-full" />
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card className="h-fit space-y-4">
          <Skeleton className="h-6 w-56" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          ))}
        </Card>
        <aside className="space-y-5">
          <Card className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
          <Card className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
        </aside>
      </div>
    </main>
  );
}
