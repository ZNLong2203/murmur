import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rangeFor } from "@/lib/range";

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  week: z.coerce.number().int().min(1).max(48),
});

/** GET /api/range?lat=40.2&lon=-8.4&week=23 → species expected there that week. */
export function GET(request: NextRequest) {
  const parsed = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "lat, lon and week (1–48) are required" }, { status: 400 });
  }
  const { lat, lon, week } = parsed.data;
  return NextResponse.json(rangeFor(lat, lon, week), {
    headers: { "cache-control": "public, max-age=86400, immutable" },
  });
}
