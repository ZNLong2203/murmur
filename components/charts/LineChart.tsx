"use client";

import { useId, useState } from "react";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

interface Props {
  title: string;
  x: number[];
  xLabel: string;
  formatX: (v: number) => string;
  series: Series[];
  /** y domain, fixed so the reader can compare charts. */
  yMax: number;
  formatY: (v: number) => string;
  yTicks: number[];
  /** Optional vertical reference line (e.g. a threshold) with a short note. */
  reference?: { x: number; label: string };
}

const W = 640;
const H = 280;
const M = { top: 16, right: 20, bottom: 40, left: 48 };

/**
 * A small, accessible line chart: 2px lines, 8px markers with a surface ring,
 * hairline grid, a crosshair that snaps to the nearest x with one tooltip for
 * every series, a legend of line keys, and the same numbers in a table.
 */
export function LineChart({ title, x, xLabel, formatX, series, yMax, formatY, yTicks, reference }: Props) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  const sx = (v: number) => M.left + ((v - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
  const sy = (v: number) => H - M.bottom - (v / yMax) * (H - M.top - M.bottom);

  const paths = series.map((s) => {
    let d = "";
    s.values.forEach((v, i) => {
      if (v == null) return;
      d += `${d && s.values[i - 1] != null ? "L" : "M"}${sx(x[i]).toFixed(1)},${sy(v).toFixed(1)}`;
    });
    return d;
  });

  function nearestIndex(clientX: number, rect: DOMRect) {
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    x.forEach((v, i) => {
      if (Math.abs(sx(v) - px) < Math.abs(sx(x[best]) - px)) best = i;
    });
    return best;
  }

  return (
    <figure className="w-full">
      <figcaption className="mb-2 text-sm font-medium text-ink">{title}</figcaption>
      <ul className="mb-2 flex flex-wrap gap-4 text-xs text-ink-2" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="17" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-labelledby={`${id}-desc`}
          tabIndex={0}
          onPointerMove={(e) => setHover(nearestIndex(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(x.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? x.length) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(x.length - 1, (h ?? -1) + 1));
          }}
        >
          <desc id={`${id}-desc`}>{title}. The same values are in the table below the chart.</desc>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={M.left - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted font-mono text-[11px]">
                {formatY(t)}
              </text>
            </g>
          ))}
          {x.map((v) => (
            <text key={v} x={sx(v)} y={H - M.bottom + 18} textAnchor="middle" className="fill-muted font-mono text-[11px]">
              {formatX(v)}
            </text>
          ))}
          <text x={(M.left + W - M.right) / 2} y={H - 4} textAnchor="middle" className="fill-ink-2 text-[11px]">
            {xLabel}
          </text>
          {reference && (
            <g>
              <line x1={sx(reference.x)} x2={sx(reference.x)} y1={M.top} y2={H - M.bottom} stroke="var(--line-strong)" strokeWidth="1" />
              <text x={sx(reference.x) + 6} y={M.top + 10} className="fill-muted text-[11px]">
                {reference.label}
              </text>
            </g>
          )}
          {hover !== null && <line x1={sx(x[hover])} x2={sx(x[hover])} y1={M.top} y2={H - M.bottom} stroke="var(--ink-2)" strokeWidth="1" />}
          {series.map((s, si) => (
            <g key={s.key}>
              <path d={paths[si]} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) =>
                v == null ? null : <circle key={i} cx={sx(x[i])} cy={sy(v)} r={hover === i ? 5.5 : 4} fill={s.color} stroke="var(--card)" strokeWidth="2" />,
              )}
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-sm"
            style={{ left: `${(sx(x[hover]) / W) * 100}%`, transform: `translateX(${sx(x[hover]) > W * 0.6 ? "-110%" : "10%"})` }}
            role="status"
          >
            <p className="mb-1 font-mono text-muted">{formatX(x[hover])}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-2">
                <svg width="12" height="6" aria-hidden="true">
                  <line x1="1" y1="3" x2="11" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <strong className="font-mono text-ink">{s.values[hover] == null ? "–" : formatY(s.values[hover]!)}</strong>
                <span className="text-ink-2">{s.label}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted">Show the numbers</summary>
        <table className="mt-2 w-full text-left font-mono text-xs [font-variant-numeric:tabular-nums]">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-4 font-normal">{xLabel}</th>
              {series.map((s) => (
                <th key={s.key} className="py-1 pr-4 font-normal">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {x.map((v, i) => (
              <tr key={v} className="border-t border-line">
                <td className="py-1 pr-4">{formatX(v)}</td>
                {series.map((s) => (
                  <td key={s.key} className="py-1 pr-4">
                    {s.values[i] == null ? "–" : formatY(s.values[i]!)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
