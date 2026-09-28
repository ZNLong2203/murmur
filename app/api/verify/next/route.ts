import { NextResponse, type NextRequest } from "next/server";
import { nextForVoter } from "@/lib/commons/repo";
import { getDb } from "@/lib/db/client";
import { HttpError, errorResponse } from "@/lib/http";

/** GET /api/verify/next?voter=anon-…&expert=1 — the next clip to listen to. */
export async function GET(request: NextRequest) {
  try {
    const voter = request.nextUrl.searchParams.get("voter") ?? "";
    if (!/^anon-[a-z0-9-]{4,40}$/i.test(voter)) throw new HttpError(400, "voter must be a Murmur pseudonym");
    const expert = request.nextUrl.searchParams.get("expert") === "1";
    return NextResponse.json({ item: await nextForVoter(await getDb(), voter, expert) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
