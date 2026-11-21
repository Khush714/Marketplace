import { NextRequest, NextResponse } from "next/server";

import { cleanupCustomerAuthArtifacts } from "@/db/customer-accounts";
import { requireCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled maintenance for authenticated customer-account auth artifacts.
 *
 * Prunes expired/consumed OTP challenges and expired/revoked account sessions
 * after a short retention grace period. Safe to run repeatedly: only rows that
 * are no longer live/usable are removed, and live sessions are never deleted.
 */
async function run() {
  const cleaned = await cleanupCustomerAuthArtifacts();
  return NextResponse.json({ ok: true, ...cleaned });
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
