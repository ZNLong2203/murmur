import Link from "next/link";
import { Wordmark } from "@/components/brand/Logo";
import { NavLinks } from "./NavLinks";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
        <Link href="/" aria-label="Murmur home">
          <Wordmark />
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
