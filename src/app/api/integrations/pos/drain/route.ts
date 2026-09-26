import { NextRequest } from "next/server";
import { processPendingPosDeliveries } from "@/integrations/pos/order-bridge";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/integrations/pos/drain
 *
 * Ops trigger for the delivery worker: drains every due PENDING journal row in
 * one pass and reports the outcomes. Gated by the shared ops token so the
 * public internet can't hammer the drain. See src/lib/ops-auth.ts — an unset
 * token stays open for local dev, production without one denies outright.
 */
export async function POST(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const summary = await processPendingPosDeliveries();
  return Response.json({ ok: true, ...summary });
}
