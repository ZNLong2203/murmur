import { NextResponse } from "next/server";
import { commonsStats } from "@/lib/commons/repo";
import { getDb } from "@/lib/db/client";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    return NextResponse.json(await commonsStats(await getDb()), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
