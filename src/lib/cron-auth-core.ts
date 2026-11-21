/**
 * Authorization decision for the scheduled drain endpoints.
 *
 * Kept free of `server-only` and of any Next import so the decision itself is
 * unit-testable — the `server-only` marker throws by design outside the Next
 * bundler, so the logic cannot live in the same file as the marker.
 *
 * The in-process POS drain loop cannot run on a serverless host, so the drains
 * moved to scheduled HTTP endpoints. That trades an internal timer for a
 * privileged public route, and the two failure modes worth pinning are:
 *
 *   - Open drain. An unauthenticated caller could drive the delivery journal,
 *     burn the POS's rate limit and keep retrying other tenants' orders. With
 *     neither secret configured the decision is `unconfigured`, never
 *     `authorized`, so the caller fails closed.
 *   - Spoofed scheduler header. `x-vercel-cron` is only trustworthy because the
 *     platform injects it on requests it originates; off Vercel it must not
 *     authenticate anyone.
 *
 * Both secrets are compared with timingSafeEqual: a plain `!==` on a bearer
 * secret leaks its prefix through response timing.
 */

import { timingSafeEqual } from "node:crypto";

export const CRON_HEADER = "x-vercel-cron";
export const OPS_TOKEN_HEADER = "x-ops-token";

export type HeaderLookup = { get(name: string): string | null };

export type CronAuthOutcome = "authorized" | "unauthorized" | "unconfigured";

export type CronAuthEnv = {
  cronSecret?: string | undefined;
  opsToken?: string | undefined;
  onVercel?: boolean | undefined;
};

function constantTimeEquals(a: string, b: string): boolean {
  const expected = Buffer.from(a);
  const actual = Buffer.from(b);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Decide whether a scheduled call may run a drain.
 *
 * - `unconfigured` — neither `CRON_SECRET` nor `POS_DELIVERY_OPS_TOKEN` is set.
 *   Callers must refuse (503) rather than run: an open drain endpoint lets a
 *   stranger drive the delivery journal at will.
 * - `authorized` — a valid ops token, a valid `Bearer CRON_SECRET`, or a
 *   genuine Vercel Cron invocation (only trusted when `onVercel`).
 * - `unauthorized` — anything else.
 */
export function decideCronAuth(headers: HeaderLookup, env: CronAuthEnv): CronAuthOutcome {
  const cronSecret = (env.cronSecret ?? "").trim();
  const opsToken = (env.opsToken ?? "").trim();

  if (!cronSecret && !opsToken) return "unconfigured";

  if (opsToken) {
    const provided = (headers.get(OPS_TOKEN_HEADER) ?? "").trim();
    if (provided && constantTimeEquals(provided, opsToken)) return "authorized";
  }

  if (cronSecret) {
    const auth = headers.get("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (bearer && constantTimeEquals(bearer, cronSecret)) return "authorized";
  }

  // The platform only injects x-vercel-cron on requests its own scheduler
  // originates, so it is trusted exclusively when we are actually on Vercel.
  if (cronSecret && env.onVercel && headers.get(CRON_HEADER)) return "authorized";

  return "unauthorized";
}