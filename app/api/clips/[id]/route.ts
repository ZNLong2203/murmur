import { getClip } from "@/lib/commons/repo";
import { getDb } from "@/lib/db/client";
import { errorResponse, HttpError } from "@/lib/http";

/** GET /api/clips/:id — the 3-second clip a recordist shared for one call. */
export async function GET(_request: Request, ctx: RouteContext<"/api/clips/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "Bad clip id");
    const clip = await getClip(await getDb(), id);
    if (!clip) throw new HttpError(404, "No clip");
    return new Response(Buffer.from(clip.bytes), { headers: { "content-type": clip.mime, "cache-control": "public, max-age=31536000, immutable" } });
  } catch (err) {
    return errorResponse(err);
  }
}
