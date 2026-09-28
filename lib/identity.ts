"use client";

// Each browser keeps a random secret. It goes to the server with shares and
// votes; the public handle ("anon-…") is derived from its hash, so handles
// can be shown without letting anyone act as someone else.

const KEY = "murmur-token";
let memoryToken: string | null = null;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function identityToken(): string {
  try {
    let token = localStorage.getItem(KEY);
    if (!token) {
      token = randomToken();
      localStorage.setItem(KEY, token);
    }
    return token;
  } catch {
    memoryToken ??= randomToken();
    return memoryToken;
  }
}

export async function publicHandle(token = identityToken()): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `anon-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12)}`;
}
