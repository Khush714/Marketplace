import { NextRequest } from "next/server";

import { getPayoutSettings, savePayoutSettings } from "@/db/merchant-payouts";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import {
  normalizePayoutCycle,
  normalizePayoutEnabled,
  PayoutInputError,
} from "@/lib/payout-core";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } } as const;

function invalid(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/** Owner-selectable payout cadence for the paired listing. */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const settings = await getPayoutSettings(auth.restaurantId);
  return Response.json({ ok: true, settings }, NO_STORE);
}

/** Changing the cycle changes future previews only; it never moves money. */
export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown>;
  try {
    const cycle = normalizePayoutCycle(body.cycle);
    const enabled = normalizePayoutEnabled(body.enabled);
    const settings = await savePayoutSettings(auth.restaurantId, { cycle, enabled });
    return Response.json({ ok: true, settings }, NO_STORE);
  } catch (error) {
    if (error instanceof PayoutInputError) return invalid(error.message);
    throw error;
  }
}
