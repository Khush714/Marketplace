import { NextRequest } from "next/server";
import { listMerchantSettlements } from "@/db/merchant-settlements";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";

/** Server-to-server settlement feed. Tenant identity is resolved from the business-scoped bearer token. */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const settlements = await listMerchantSettlements(auth.restaurantId);
  return Response.json({ ok: true, settlements }, { headers: { "Cache-Control": "no-store" } });
}
