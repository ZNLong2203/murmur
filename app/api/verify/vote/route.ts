import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { castVote } from "@/lib/commons/repo";
import { getDb } from "@/lib/db/client";
import { HttpError, errorResponse, rateLimited, readJson } from "@/lib/http";

const Vote = z.object({
  detectionId: z.uuid(),
  voter: z.string().regex(/^anon-[a-z0-9-]{4,40}$/i),
  vote: z.enum(["yes", "no", "unsure"]),
  expertCode: z.string().max(80).optional(),
});

/** POST /api/verify/vote — one listener's verdict; the status is recomputed server-side. */
export async function POST(request: NextRequest) {
  try {
    if (rateLimited(request, "vote", 300, 60 * 60 * 1000)) throw new HttpError(429, "Too many votes from this network; take a break and come back.");
    const parsed = Vote.safeParse(await readJson(request, 2_000));
    if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
    const { detectionId, voter, vote, expertCode } = parsed.data;
    const expectedCode = process.env.MURMUR_EXPERT_CODE;
    const expert = Boolean(expertCode && expectedCode && expertCode === expectedCode);
    if (expertCode && !expert) throw new HttpError(403, "That expert code is not valid.");
    const status = await castVote(await getDb(), detectionId, voter, vote, expert);
    if (!status) throw new HttpError(404, "No such call");
    return NextResponse.json({ status, expert });
  } catch (err) {
    return errorResponse(err);
  }
}
