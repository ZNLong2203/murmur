import { Card, CardTitle } from "@/components/ui/primitives";
import type { LabSummary, QualityClass } from "@/lib/oah/types";

const QUALITY_COLOR: Record<QualityClass, string> = {
  High: "var(--ok)",
  Good: "var(--ok)",
  Moderate: "var(--warn)",
  Poor: "var(--bad)",
  Bad: "var(--bad)",
};

/** Same four bands the OneAquaHealth City Dashboards use for a 0–1 risk. */
export function riskBand(value: number): { word: string; color: string } {
  if (value < 0.25) return { word: "Low", color: "var(--ok)" };
  if (value < 0.5) return { word: "Moderate", color: "var(--warn)" };
  if (value < 0.75) return { word: "High", color: "var(--bad)" };
  return { word: "Very high", color: "var(--bad)" };
}

const month = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export function LabCard({ lab }: { lab: LabSummary }) {
  const ecology = [
    ["Fish", lab.ecology.fish],
    ["Invertebrates", lab.ecology.macroinvertebrates],
    ["Diatoms", lab.ecology.diatoms],
  ] as const;
  const risks = lab.risk
    ? ([
        ["Pathogens", lab.risk.scaledPathogenRisk],
        ["Faecal bacteria", lab.risk.scaledFecalRisk],
        ["Antibiotic-resistance genes", lab.risk.scaledArgRisk],
      ] as const)
    : [];
  const worst = risks.length ? Math.max(...risks.map(([, v]) => v)) : null;

  return (
    <Card data-testid="lab-card">
      <CardTitle hint={`OneAquaHealth lab results for ${lab.site.code} · ${lab.site.name}`}>What the ear can&apos;t tell you</CardTitle>

      {worst !== null && worst >= 0.25 && (
        <p className="mb-3 rounded-lg bg-paper-2 px-3 py-2 text-sm text-ink-2">
          A lively soundscape does not mean the water is safe to touch: the lab found{" "}
          <strong style={{ color: riskBand(worst).color }}>{riskBand(worst).word.toLowerCase()}</strong> microbial risk here.
        </p>
      )}

      {risks.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Water-related health risk · {month(lab.risk!.samplingDate)}</h3>
          <ul className="mt-1.5 space-y-1 text-sm">
            {risks.map(([name, v]) => (
              <li key={name} className="flex items-center justify-between gap-2">
                <span className="text-ink-2">{name}</span>
                <span className="font-medium" style={{ color: riskBand(v).color }}>
                  {riskBand(v).word} <span className="font-mono text-xs text-muted">{v.toFixed(2)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Ecological quality</h3>
        <ul className="mt-1.5 space-y-1 text-sm">
          {ecology.map(([name, value]) => (
            <li key={name} className="flex items-center justify-between gap-2">
              <span className="text-ink-2">{name}</span>
              {value ? (
                <span className="font-medium" style={{ color: QUALITY_COLOR[value.quality] }}>
                  {value.quality} <span className="text-xs font-normal text-muted">{month(value.date)}</span>
                </span>
              ) : (
                <span className="text-muted">not sampled</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-xs text-muted">
        Source: OneAquaHealth public API (City Dashboards and Resilience Map). Sound tells you who is living here; only sampling tells you what is in the water.
      </p>
    </Card>
  );
}
