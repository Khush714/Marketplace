import { NextRequest } from "next/server";

import { createPayoutBatch } from "@/db/merchant-payouts";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import { PayoutConflictError, PayoutInputError } from "@/lib/payout-core";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } } as const;

/** Freeze the last closed payout window as an immutable preview batch. */
export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();

  try {
    const batch = await createPayoutBatch(auth.restaurantId);
    return Response.json({ ok: true, batch }, { status: 201, ...NO_STORE });
  } catch (error) {
    if (error instanceof PayoutInputError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof PayoutConflictError) {
      return Response.json({ ok: false, error: error.message }, { status: 409 });
    }
    throw error;
  }
}
