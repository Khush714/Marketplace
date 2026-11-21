import "server-only";

import type { NextRequest } from "next/server";

import { decideCronAuth, type CronAuthOutcome } from "@/lib/cron-auth-core";

export { CRON_HEADER } from "@/lib/cron-auth-core";

/**
 * Shared guard for the scheduled drain endpoints that replace the in-process
 * instrumentation loop on serverless hosts (Vercel functions are ephemeral and
 * scale to zero, so the loop never runs reliably there).
 *
 * Reuses the ops token so there is exactly one privileged secret to provision,
 * and additionally accepts `CRON_SECRET` for platforms that sign scheduled calls
 * with a bearer token (GitHub Actions, external schedulers, QStash).
 *
 * The decision itself — constant-time comparison, fail-closed on an
 * unconfigured deployment, and refusing to trust a spoofed `x-vercel-cron`
 * header off-platform — lives in `cron-auth-core` so it is unit-testable; the
 * `server-only` marker below throws by design outside the Next bundler.
 */
export function authorizeCronRequest(req: NextRequest): CronAuthOutcome {
  return decideCronAuth(req.headers, {
    cronSecret: process.env.CRON_SECRET,
    opsToken: process.env.POS_DELIVERY_OPS_TOKEN,
    onVercel: !!process.env.VERCEL,
  });
}

/** The 401/503 `Response` for a denied cron call, or `null` when authorized. */
export function requireCronAuth(req: NextRequest): Response | null {
  const outcome = authorizeCronRequest(req);
  if (outcome === "authorized") return null;
  if (outcome === "unconfigured") {
    return Response.json(
      {
        ok: false,
        error: "Scheduled drains are not configured on this deployment",
        code: "CRON_AUTH_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}