import { NextRequest } from "next/server";
import { processPendingPaymentDeliveries } from "@/integrations/pos/payment-bridge";
import { reconcilePayments } from "@/integrations/payments/reconcile";
import { requireOpsToken } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/integrations/payments/ops
 *
 * Ops trigger for the payment pipeline: drains due POS payment deliveries and
 * runs the payment reconciliation classifier. Uses the shared ops guard
 * (src/lib/ops-auth.ts) — constant-time, and production denies outright when
 * POS_DELIVERY_OPS_TOKEN is unset rather than leaving reconciliation open.
 */
export async function POST(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;

  const drive = { drain: true, reconcile: true, ...(await req.json().catch(() => ({}))) };

  const drain = drive.drain ? await processPendingPaymentDeliveries() : null;
  const reconcile = drive.reconcile ? await reconcilePayments() : null;

  return Response.json({ ok: true, drain, reconcile });
}