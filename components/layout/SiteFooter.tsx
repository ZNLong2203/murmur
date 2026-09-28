import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-paper-2/60">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-muted md:grid-cols-3">
        <div>
          <p className="font-medium text-ink">Your recording stays with you.</p>
          <p className="mt-1">
            Analysis runs in your browser. Nothing is uploaded unless you choose to share the calls you confirmed.
          </p>
        </div>
        <div>
          <p>
            Sound identification powered by{" "}
            <a className="underline decoration-line-strong underline-offset-2 hover:text-ink" href="https://birdnet.cornell.edu/">
              BirdNET
            </a>{" "}
            (BirdNET+ V3.0 developer preview, CC BY-SA 4.0).
          </p>
          <p className="mt-1">
            Research sites and lab results from the{" "}
            <a className="underline decoration-line-strong underline-offset-2 hover:text-ink" href="https://www.oneaquahealth.eu/">
              OneAquaHealth
            </a>{" "}
            project&apos;s public API.
          </p>
        </div>
        <div>
          <p>Built for the IEEE OneAquaHealth Global Hackathon 2026.</p>
          <p className="mt-1">
            <Link className="underline decoration-line-strong underline-offset-2 hover:text-ink" href="/evidence">
              Methods, limits and credits
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
