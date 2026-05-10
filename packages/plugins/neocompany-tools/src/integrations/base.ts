/**
 * Shared helpers for social provider implementations.
 *
 * PKCE, random state, URL builders — keep provider files focused on the
 * API-specific parts (endpoints, body shapes, error mapping).
 */

import { createHash, randomBytes } from "node:crypto";

/** Generates an unpredictable state value for the OAuth redirect dance. */
export function randomState(bytes = 24): string {
  return base64Url(randomBytes(bytes));
}

/** Generates a PKCE code_verifier + code_challenge pair (SHA-256). */
export function buildPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** URL-safe base64 without padding. */
export function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function buildQuery(params: Record<string, string | undefined>): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return pairs.join("&");
}

/**
 * POST a `application/x-www-form-urlencoded` body and return JSON.
 * Most OAuth providers accept this form for their `/token` endpoints.
 */
export async function postForm<T>(
  url: string,
  body: Record<string, string | undefined>,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const encoded = buildQuery(body);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...extraHeaders,
    },
    body: encoded,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

/** Compute absolute expiresAt from an `expires_in` (seconds) response. */
export function expiresAtFromSeconds(seconds: number | undefined | null): number | null {
  if (!seconds || seconds <= 0) return null;
  return Date.now() + seconds * 1000;
}
