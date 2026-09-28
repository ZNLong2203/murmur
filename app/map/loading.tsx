import { Card, Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p role="status" className="sr-only">
        Loading the stream map…
      </p>
      <header className="mb-6 max-w-3xl space-y-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </header>
      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <div>
          <div className="mb-3 flex flex-wrap justify-between gap-2">
            <Skeleton className="h-9 w-72 rounded-full" />
            <Skeleton className="h-9 w-80 rounded-full" />
          </div>
          <Skeleton className="h-[62vh] min-h-[420px] rounded-2xl border border-line" />
        </div>
        <Card className="h-fit space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
      </div>
    </main>
  );
}
