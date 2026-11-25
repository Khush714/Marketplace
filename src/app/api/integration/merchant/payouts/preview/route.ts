import { NextRequest } from "next/server";

import { previewMerchantPayout } from "@/db/merchant-payouts";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";

/**
 * Read-only payout preview for the paired listing. It prices a closed window
 * from signature-verified settlements but writes no batch and moves no money.
 */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const result = await previewMerchantPayout(auth.restaurantId);
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
