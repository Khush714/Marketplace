import { NextRequest } from "next/server";
import { getPartnerMenu } from "@/db/partner-menu";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const menu = await getPartnerMenu(auth.restaurantId);
  if (!menu) return Response.json({ ok: false, error: "Merchant not found" }, { status: 404 });
  return Response.json({ ok: true, menu }, { headers: { "Cache-Control": "no-store" } });
}
