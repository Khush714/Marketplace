import { NextRequest } from "next/server";
import { getMerchantOrderSummary } from "@/db/merchant-orders";
import { getRestaurantManageById } from "@/db/queries";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const [restaurant, overview] = await Promise.all([
    getRestaurantManageById(auth.restaurantId),
    getMerchantOrderSummary(auth.restaurantId),
  ]);
  if (!restaurant) return Response.json({ ok: false, error: "Merchant not found" }, { status: 404 });
  return Response.json({ ok: true, restaurant, overview }, { headers: { "Cache-Control": "no-store" } });
}
