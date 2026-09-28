import { Card, Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p role="status" className="sr-only">
        Opening the listening page…
      </p>
      <header className="mb-6 max-w-3xl space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </header>
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <Card className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-44 w-full rounded-xl" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-36 rounded-full" />
            ))}
          </div>
        </Card>
        <Card className="h-fit space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-11 w-full rounded-full" />
        </Card>
      </div>
    </main>
  );
}
