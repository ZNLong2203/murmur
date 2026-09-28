import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const BUTTON: Record<Variant, string> = {
  primary: "bg-brand text-paper hover:bg-brand-ink disabled:bg-line-strong disabled:text-paper",
  secondary: "border border-line-strong bg-card text-ink hover:border-ink-2 disabled:text-muted",
  ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink disabled:text-muted",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-2xl border border-line bg-card p-5 ${className}`} {...props} />;
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <header className="mb-3">
      <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{children}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
    </header>
  );
}

/** A grey block standing in for content while a page loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  // Tailwind orders rounded-* utilities itself, so the default must step aside rather than compete.
  const radius = className.includes("rounded-") ? "" : "rounded-lg";
  return <div aria-hidden="true" className={`animate-pulse bg-paper-2 ${radius} ${className}`} />;
}

export function Chip({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={
        color
          ? { borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)`, color }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function Meter({ value, color = "var(--brand)", label }: { value: number; color?: string; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
