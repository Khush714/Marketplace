import { NextRequest, NextResponse } from "next/server";

import { readDrainHealth, readQueueHealth } from "@/lib/queue-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/ops/queue-health — alertable delivery-queue state.
 *
 * Split out from /api/ops/pos-bridge because that route answers 401 without the
 * ops token, which makes it unusable as an uptime/alerting target: a monitor
 * cannot hold a secret in most setups, and a 401 tells you nothing about the
 * queue anyway.
 *
 * This route returns the counters unauthenticated but carries NO tenant data:
 * four integers per journal plus a drain-mode flag. That is the same disclosure
 * class as an uptime check on a public site, and it is what lets the terminal
 * `FAILED` count be alerted on instead of discovered by a customer.
 *
 * HTTP status is the alert signal:
 *   200 — queue healthy (no terminal failures, nothing stale).
 *   503 — terminal delivery failures exist, or PENDING work has been owed for
 *         longer than STALE_PENDING_SECONDS. Body always carries the numbers.
 */
const STALE_PENDING_SECONDS = 300;

export async function GET(req: NextRequest) {
  // Ops callers get the same payload; the token is optional, never required.
  const requestedByOps = !!req.headers.get("x-ops-token");

  let queues: Awaited<ReturnType<typeof readQueueHealth>> | null = null;
  try {
    queues = await readQueueHealth();
  } catch (e) {
    console.error("[ops/queue-health] read failed", e);
    return NextResponse.json(
      {
        ok: false,
        error: "queue health unavailable",
        drain: readDrainHealth(),
        requestedByOps,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const drain = readDrainHealth();

  const terminalFailures =
    queues.orders.failed + queues.payments.failed;
  const ages = [queues.orders.oldestPendingAgeSeconds, queues.payments.oldestPendingAgeSeconds]
    .filter((a): a is number => a != null);
  const oldestPending = ages.length ? Math.max(...ages) : null;

  const ok = terminalFailures === 0 && (oldestPending ?? 0) < STALE_PENDING_SECONDS;

  return NextResponse.json(
    {
      ok,
      ...(ok ? {} : { alerts: buildAlerts(terminalFailures, oldestPending) }),
      terminalFailures,
      oldestPendingAgeSeconds: oldestPending,
      staleAfterSeconds: STALE_PENDING_SECONDS,
      queues,
      drain,
      requestedByOps,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

function buildAlerts(terminalFailures: number, oldestPending: number | null): string[] {
  const alerts: string[] = [];
  if (terminalFailures > 0) {
    alerts.push(
      `${terminalFailures} marketplace→POS delivery/delivery payment(s) are terminally FAILED and will not be retried; investigate the POS and re-drive or compensate the affected orders`,
    );
  }
  if (oldestPending != null && oldestPending >= STALE_PENDING_SECONDS) {
    alerts.push(
      `oldest PENDING delivery has been owed for ${oldestPending}s (threshold ${STALE_PENDING_SECONDS}s); the drain is not keeping up or the schedule is not firing`,
    );
  }
  return alerts;
}