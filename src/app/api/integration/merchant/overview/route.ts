import { NextRequest } from "next/server";
import { getMerchantOverview, getMerchantRestaurantSettings } from "@/db/merchant-integration";
import { guardRead } from "@/lib/abuse";
import { requireMerchantIntegration } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "merchantIntegrationRead");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const [restaurant, overview] = await Promise.all([
    getMerchantRestaurantSettings(auth.session.restaurant.id),
    getMerchantOverview(auth.session.restaurant.id),
  ]);
  if (!restaurant) {
    return Response.json({ ok: false, error: "Marketplace listing not found." }, { status: 404 });
  }
  return Response.json(
    { ok: true, restaurant, overview },
    { headers: { "Cache-Control": "no-store" } },
  );
}
