import { NextRequest } from "next/server";
import { getMerchantRevenue } from "@/db/merchant-revenue";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import { MerchantRevenueRangeError, normalizeMerchantRevenueRange } from "@/lib/merchant-revenue";

export const dynamic = "force-dynamic";

/** Authoritative revenue totals for the paired Merchant App's selected date range. */
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

  const revenue = await getMerchantRevenue(auth.restaurantId, range);
  return Response.json({ ok: true, revenue }, { headers: { "Cache-Control": "no-store" } });
}
