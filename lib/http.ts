import "server-only";
import { NextResponse } from "next/server";

// Small, honest guards for a public demo API: a per-IP rate limit (per
// server instance, best effort) and a body-size cap before parsing.

const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000;

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

/** True when this network has already used `limit` requests in the window. */
export function rateLimited(request: Request, key: string, limit: number, windowMs: number): boolean {
  const id = `${key}:${clientIp(request)}`;
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(id, recent);
    return true;
  }
  recent.push(now);
  hits.set(id, recent);
  if (hits.size > MAX_KEYS) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return false;
}

/** Count a failure (e.g. a wrong expert code) without consuming the normal budget. */
export function recordFailure(request: Request, key: string, limit: number, windowMs: number): boolean {
  return rateLimited(request, `${key}-fail`, limit, windowMs);
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new HttpError(413, "Request too large");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof SyntaxError) return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
}
