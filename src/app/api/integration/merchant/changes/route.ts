import { NextRequest } from "next/server";
import { getMerchantSyncVersion } from "@/db/merchant-orders";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

/**
 * Tiny change signal polled by the paired Merchant App while its workspace is
 * open. It answers with two opaque tokens, not order data: the browser downloads
 * the inbox only when one of them moves. Tenant identity comes from the same
 * per-business bearer token used by the existing integration endpoints.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceSignal");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const version = await getMerchantSyncVersion(auth.restaurantId);
  return Response.json(
    { ok: true, ...version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
