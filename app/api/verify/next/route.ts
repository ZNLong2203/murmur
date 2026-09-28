import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { nextForVoter } from "@/lib/commons/repo";
import { getDb } from "@/lib/db/client";
import { HttpError, errorResponse, recordFailure } from "@/lib/http";
import { handleFor, isExpertCode, Token } from "@/lib/server/identity";

const Skip = z.array(z.uuid()).max(50);

/**
 * GET /api/verify/next?skip=<ids>: the next clip to listen to. The listener's
 * token travels in x-murmur-token (never in the URL) and an expert code, if
 * any, in x-murmur-expert.
 */
export async function GET(request: NextRequest) {
  try {
    const token = Token.safeParse(request.headers.get("x-murmur-token"));
    if (!token.success) throw new HttpError(400, "A Murmur browser token is required");
    const code = request.headers.get("x-murmur-expert");
    const expert = isExpertCode(code);
    if (code && !expert) {
      if (recordFailure(request, "expert", 10, 60 * 60 * 1000)) throw new HttpError(429, "Too many wrong expert codes; try again later.");
      throw new HttpError(403, "That expert code is not valid.");
    }
    const skipParam = request.nextUrl.searchParams.get("skip");
    const skip = Skip.safeParse(skipParam ? skipParam.split(",") : []);
    if (!skip.success) throw new HttpError(400, "skip must be a list of call ids");
    const item = await nextForVoter(await getDb(), handleFor(token.data), expert, skip.data);
    return NextResponse.json({ item, expert }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
