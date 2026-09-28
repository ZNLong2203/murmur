"use client";

import { LineChart } from "@/components/charts/LineChart";

interface Row {
  snrDb: number;
  recall03: number;
  recall05: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Client wrapper: formatters are functions and cannot cross from a server page. */
export function SnrChart({ rows }: { rows: Row[] }) {
  const sorted = [...rows].sort((a, b) => a.snrDb - b.snrDb);
  return (
    <LineChart
      title="Share of calls still detected as the water gets louder"
      x={sorted.map((r) => r.snrDb)}
      xLabel="Signal-to-noise ratio (dB, call vs water)"
      formatX={(v) => `${v > 0 ? "+" : ""}${v} dB`}
      series={[
        { key: "r03", label: "Detected at score ≥ 0.3", color: "var(--chart-1)", values: sorted.map((r) => r.recall03) },
        { key: "r05", label: "Detected at score ≥ 0.5", color: "var(--chart-2)", values: sorted.map((r) => r.recall05) },
      ]}
      yMax={1}
      yTicks={[0, 0.25, 0.5, 0.75, 1]}
      formatY={pct}
    />
  );
}
