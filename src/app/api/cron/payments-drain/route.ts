import { NextRequest, NextResponse } from "next/server";

import { processPendingPaymentDeliveries } from "@/integrations/pos/payment-bridge";
import { reconcilePayments } from "@/integrations/payments/reconcile";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled payment pipeline: drains due POS payment webhook pushes and runs
 * the reconciliation classifier, mirroring POST /api/integrations/payments/ops
 * under scheduler auth. Same idempotency argument as the order drain.
 */
async function run() {
  const drained = await processPendingPaymentDeliveries();
  const reconciled = await reconcilePayments();
  return NextResponse.json({ ok: true, drained, reconciled });
}

export async function POST(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return run();
}

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  return run();
}