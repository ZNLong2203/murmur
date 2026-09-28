import { NextResponse } from "next/server";
import { loadGbifKeys } from "@/lib/content";

/** GBIF backbone keys for every species a range list can let through. */
export function GET() {
  return NextResponse.json(loadGbifKeys(), { headers: { "cache-control": "public, max-age=86400" } });
}
