import type { Metadata } from "next";
import { VerifyQueue } from "@/components/verify/VerifyQueue";

export const metadata: Metadata = {
  title: "Lend an ear",
  description: "Listen to 3-second clips recorded at urban streams and say whether Murmur named the bird or frog right.",
};

export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Lend an ear</h1>
        <p className="mt-2 text-ink-2">
          People recorded these calls at streams in Coimbra, Toulouse, Ghent, Benevento and Oslo. Is it the species Murmur suggests? Ten seconds of your attention turns an AI guess into data researchers can trust, and you can do it from home.
        </p>
      </header>
      <VerifyQueue />
    </main>
  );
}
