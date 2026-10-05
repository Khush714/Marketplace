import { NextRequest, NextResponse } from "next/server";

import { processPendingPosDeliveries } from "@/integrations/pos/order-bridge";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled POS order-delivery drain.
 *
 * On Vercel the in-process loop in src/instrumentation.ts never runs reliably
 * (functions are ephemeral and scale to zero), so this endpoint is the drain.
 * Idempotent by construction: `processPendingPosDeliveries` only touches rows
 * that are PENDING and due, and each attempt is journaled, so overlapping
 * scheduler fires cannot double-deliver.
 */
async function run() {
  const drained = await processPendingPosDeliveries(50);
  return NextResponse.json({ ok: true, drained });
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