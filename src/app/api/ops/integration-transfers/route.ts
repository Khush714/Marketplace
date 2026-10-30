import { NextRequest } from "next/server";
import { decideIntegrationTransfer, listIntegrationTransfers } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";
import { apiError, badRequest } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/integration-transfers?status=pending
 *
 * The queue of listings asking to take a POS identity (`marketplace_id`) from a
 * listing that still holds it. Read-only; decisions go through POST.
 */
export async function GET(req: NextRequest) {
  const denied = requireOpsToken(req);
  if (denied) return denied;

  const status = (req.nextUrl.searchParams.get("status") ?? "pending")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const transfers = await listIntegrationTransfers(status);
  return Response.json({ ok: true, transfers });
}

/**
 * POST /api/ops/integration-transfers
 *   { request_id, decision: "approved" | "denied", note? }
 *
 * Ops-only decision on an identity transfer. Approval moves
 * `restaurants.marketplace_id` to the requesting listing, clears it from the
 * holder and closes the holder's integration record — the same three writes that
 * used to be hand-written SQL, now behind the checks in
 * `planTransferApproval` and a single transaction.
 *
 * Ops-gated because it takes capability away from one partner and gives it to
 * another. A restaurant must not be able to release its own identity into
 * someone else's listing, and the partner surface has no path here at all.
 */
export async function POST(req: NextRequest) {
  const denied = requireOpsToken(req);
  if (denied) return denied;

  let body: { request_id?: unknown; decision?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Invalid request.");
  }

  const requestId = Number(body.request_id);
  const decision = String(body.decision ?? "");
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return badRequest("request_id is required");
  }
  if (decision !== "approved" && decision !== "denied") {
    return badRequest('decision must be "approved" or "denied"');
  }

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const result = await decideIntegrationTransfer({
    requestId,
    decision,
    // The token is a shared secret, so it is never recorded as the actor: an
    // audit entry naming a bearer token would outlive the token's rotation.
    actor: "ops",
    ipAddress,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
  });

  if (!result.ok) {
    // Stale conditions, not permission problems: the operator's read was out of
    // date. 409 so the console refreshes instead of showing a hard failure.
    return apiError(409, result.error, result.code);
  }
  return Response.json(result);
}
