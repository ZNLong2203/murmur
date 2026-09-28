"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/analyze", label: "Analyse" },
  { href: "/map", label: "Streams" },
  { href: "/verify", label: "Verify" },
  { href: "/evidence", label: "Evidence" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mr-2 flex items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`) || (href === "/map" && pathname.startsWith("/sites/"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-2.5 py-1.5 transition-colors sm:px-3 ${
              active ? "bg-brand-soft font-medium text-brand-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
