import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// A contributor proves who they are with a random secret kept in their
// browser. The server stores and shows only a handle derived from its
// hash, so handles are public and tokens never are.

export const Token = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, "a Murmur browser token");

export function handleFor(token: string): string {
  return `anon-${createHash("sha256").update(token).digest("hex").slice(0, 12)}`;
}

/** Constant-time check of an expert code against MURMUR_EXPERT_CODE. */
export function isExpertCode(code: string | null | undefined): boolean {
  const expected = process.env.MURMUR_EXPERT_CODE;
  if (!code || !expected) return false;
  const a = createHash("sha256").update(code).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
