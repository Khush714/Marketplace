import { NextRequest } from "next/server";
import { getMerchantItemAnalytics } from "@/db/merchant-item-analytics";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import { MerchantRevenueRangeError, normalizeMerchantRevenueRange } from "@/lib/merchant-revenue";

/**
 * Authoritative per-item sales for the paired Merchant App's selected range.
 * Uses the revenue range rules so both reports agree on calendar-day boundaries.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();

  let range;
  try {
    range = normalizeMerchantRevenueRange(
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
    );
  } catch (error) {
    const message = error instanceof MerchantRevenueRangeError ? error.message : "Invalid date range.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }

  const analytics = await getMerchantItemAnalytics(auth.restaurantId, range);
  return Response.json({ ok: true, analytics }, { headers: { "Cache-Control": "no-store" } });
}
