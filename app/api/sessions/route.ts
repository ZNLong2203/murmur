import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { InvalidSession, prepareSession, SessionInput, saveSession, sessionsAt } from "@/lib/commons/repo";
import { getDb } from "@/lib/db/client";
import { HttpError, errorResponse, rateLimited, readJson } from "@/lib/http";

/** Vercel refuses bodies over 4.5 MB before this runs; stay under it. */
const MAX_BODY = 4_000_000;

/** POST /api/sessions: share the calls a recordist kept, with their clips. */
export async function POST(request: NextRequest) {
  try {
    if (rateLimited(request, "share", 20, 60 * 60 * 1000)) throw new HttpError(429, "Too many shares from this network; try again later.");
    const parsed = SessionInput.safeParse(await readJson(request, MAX_BODY));
    if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
    let prepared;
    try {
      prepared = prepareSession(parsed.data);
    } catch (err) {
      if (err instanceof InvalidSession) throw new HttpError(400, err.message);
      throw err;
    }
    const result = await saveSession(await getDb(), prepared);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /api/sessions?site=C10: shared sessions at a research site (or all). */
export async function GET(request: NextRequest) {
  try {
    const site = request.nextUrl.searchParams.get("site");
    if (site && !/^[A-Z]{1,2}\d{1,3}$/.test(site)) throw new HttpError(400, "Unknown site code");
    return NextResponse.json(await sessionsAt(await getDb(), site));
  } catch (err) {
    return errorResponse(err);
  }
}
