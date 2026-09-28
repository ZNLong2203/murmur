/** Murmur's mark: a stethoscope chest-piece whose diaphragm is a stream. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none">
      <path d="M22.5 6.5c3 1.2 5 4 5 7.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="14" cy="17" r="11" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M6.5 17.5c1.6-2 3.2-2 4.8 0s3.2 2 4.8 0 3.2-2 4.8 0"
        stroke="var(--water)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M8.5 13c1.2-1.4 2.4-1.4 3.6 0" stroke="var(--bird)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-brand-ink">
      <LogoMark />
      <span className="font-display text-xl font-semibold tracking-tight text-ink">Murmur</span>
    </span>
  );
}
