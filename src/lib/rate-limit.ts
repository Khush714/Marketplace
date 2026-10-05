import "server-only";

import { fallbackBucketKey } from "@/lib/abuse-core";

/**
 * Fixed-window rate limiter for the few endpoints that are deliberately
 * unauthenticated.
 *
 * Why this exists: `POST /api/partner/connect` redeems a connection code and is
 * NOT token-gated — the single-use code *is* the capability, and gating it would
 * break the restaurant's own onboarding handshake. But a code is only 5 symbols
 * from a 30-character alphabet (30^5 ≈ 24.3M), and the redemption endpoint
 * distinguishes "not found" from "already used" from "expired". Together those
 * make the endpoint a code-state oracle that is enumerable with a few thousand
 * requests a second, and a successful guess hands over a brand-new listing plus
 * its owner key.
 *
 * Deliberately in-process. It is the right shape for the single-node case and
 * it costs nothing; it is NOT a substitute for a shared limiter once this runs
 * on more than one instance, because each instance keeps its own window and the
 * effective limit scales with the replica count. Behind a shared rate limiter at
 * the edge, drop this.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Drop expired windows so a long-running process cannot grow without bound. */
let lastSweep = Date.now();

function sweep(now: number): void {
  // Cheap enough to run on every call at these volumes, and avoids both a
  // background timer and an unbounded map in a serverless runtime.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets. Sent as Retry-After. */
  retryAfterSeconds: number;
}

/**
 * Count one hit against `key` and report whether it is within the budget.
 *
 * @param limit  Requests permitted per window.
 * @param windowMs  Window length.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  sweep(now);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * A stable bucket key for an unauthenticated caller.
 *
 * Prefers the first entry of `x-forwarded-for` (the client as seen by the edge)
 * and falls back to the platform-provided client address. Untrusted headers are
 * fine here precisely because a caller who spoofs `x-forwarded-for` only evades
 * their own limiter — the edge's own limit still applies.
 *
 * With no address at all it falls back to `fallbackBucketKey`, which keeps
 * unrelated callers out of each other's counters.
 */
export function clientKey(req: { headers: Headers }, scope: string): string {
  const forwarded = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")[0]
    ?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "";
  if (ip) return `${scope}:${ip}`;
  return `${scope}:${fallbackBucketKey(req.headers)}`;
}

/** Standard 429 response for a throttled unauthenticated route. */
export function rateLimited(retryAfterSeconds: number): Response {
  return Response.json(
    { ok: false, error: "Too many attempts. Please wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
