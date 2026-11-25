import { NextRequest } from "next/server";

import { listMerchantPayoutFeed } from "@/db/merchant-payouts";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";

/**
 * Merchant payout mirror feed. It stays explicitly unavailable until a batch
 * has been human-approved and handed to a processor; no bank transfer is
 * initiated by this route.
 */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const feed = await listMerchantPayoutFeed(auth.restaurantId);
  return Response.json(feed, { headers: { "Cache-Control": "no-store" } });
}
