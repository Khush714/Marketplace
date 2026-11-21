import { NextRequest } from "next/server";
import { listMerchantSettlements } from "@/db/merchant-settlements";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import { normalizeMerchantSettlementPage } from "@/lib/merchant-settlements";

export const dynamic = "force-dynamic";

/** Server-to-server settlement feed. Tenant identity is resolved from the business-scoped bearer token. */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const page = normalizeMerchantSettlementPage(req.nextUrl.searchParams.get("page"));
  const result = await listMerchantSettlements(auth.restaurantId, { page });
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
