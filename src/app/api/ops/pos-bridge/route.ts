import { NextRequest } from "next/server";
import { requireOpsToken } from "@/lib/ops-auth";
import { probePosBridge } from "@/lib/pos-bridge";
import { readDrainHealth, readQueueHealth } from "@/lib/queue-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/ops/pos-bridge — is the configured POS actually reachable?
 *
 * Every marketplace→POS path (connection verify, connection claim, order
 * ingest, payment push, cancellation) resolves its host from a single env var,
 * POS_BASE_URL. When that host is wrong the ONLY thing a caller ever sees is a
 * generic 502 from a route they do not own, and the underlying fetch error was
 * discarded, so a dead integration is indistinguishable from a rejected
 * connection code. Production carried a `trycloudflare.com` quick tunnel that
 * had already stopped resolving, and nothing reported it until a restaurant
 * tried to connect.
 *
 * This probes the POS's public `GET /health` (DB-backed readiness) and reports
 * the host, the verdict and the classified cause. It never touches a
 * connection code, which is a single-use bearer credential.
 *
 * Ops-gated: it discloses where the POS lives and whether it is answering.
 */
export async function GET(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const probe = await probePosBridge();

  // A misconfigured base URL is reported here, once, at full detail. Every
  // bridge client also logs it at the point of failure, so a real outage leaves
  // a trail in the function logs even if nobody opens the console.
  //
  // The queue report is the alertable half: "is the POS up?" is only half the
  // question, because a delivery that exhausts its retries becomes terminal
  // FAILED and is never retried — nothing else in the app reports that.
  const [queues, drain] = await Promise.all([
    readQueueHealth().catch((e) => {
      console.error("[ops/pos-bridge] queue health unavailable", e);
      return null;
    }),
    Promise.resolve(readDrainHealth()),
  ]);

  return Response.json({
    ok: probe.ok && (queues?.orders.failed ?? 0) === 0 && (queues?.payments.failed ?? 0) === 0,
    probe,
    drain,
    ...(queues ? { queues } : { queues: null }),
    ...(probe.ok
      ? {}
      : {
          error:
            probe.reason === "not_configured"
              ? "POS_BASE_URL is not set on this deployment"
              : probe.reason === "loopback_in_production"
                ? "POS_BASE_URL points at loopback on a deployed function"
                : `POS is not answering: ${probe.detail ?? "unknown cause"}`,
        }),
  });
}
