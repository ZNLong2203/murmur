import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { castVote } from "@/lib/commons/repo";
import { getDb } from "@/lib/db/client";
import { HttpError, errorResponse, rateLimited, readJson, recordFailure } from "@/lib/http";
import { handleFor, isExpertCode, Token } from "@/lib/server/identity";

const Vote = z.object({
  detectionId: z.uuid(),
  token: Token,
  vote: z.enum(["yes", "no", "unsure"]),
  expertCode: z.string().max(80).optional(),
});

/** POST /api/verify/vote: one listener's verdict; the status is recomputed on the server. */
export async function POST(request: NextRequest) {
  try {
    if (rateLimited(request, "vote", 300, 60 * 60 * 1000)) throw new HttpError(429, "Too many votes from this network; take a break and come back.");
    const parsed = Vote.safeParse(await readJson(request, 2_000));
    if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
    const { detectionId, token, vote, expertCode } = parsed.data;
    const expert = isExpertCode(expertCode);
    if (expertCode && !expert) {
      if (recordFailure(request, "expert", 10, 60 * 60 * 1000)) throw new HttpError(429, "Too many wrong expert codes; try again later.");
      throw new HttpError(403, "That expert code is not valid.");
    }
    const result = await castVote(await getDb(), detectionId, handleFor(token), vote, expert);
    if (!result.ok) {
      if (result.reason === "not-found") throw new HttpError(404, "No such call");
      if (result.reason === "own-call") throw new HttpError(403, "You recorded this call, so others decide.");
      throw new HttpError(409, "This call is waiting for an expert.");
    }
    return NextResponse.json({ status: result.status, expert });
  } catch (err) {
    return errorResponse(err);
  }
}
