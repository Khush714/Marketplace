import { NextRequest } from "next/server";
import { getIntegrationRecord, getOrCreateMarketplaceId, upsertIntegrationIdentity } from "@/db/queries";
import { requireIntegrationAuth } from "../_auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const restaurant = await requireIntegrationAuth(req);
  if (!restaurant) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const marketplaceId = await getOrCreateMarketplaceId(restaurant.id);

  // Heartbeat refresh only — polling must not claim an identity; the record is
  // created by the POS when it registers its identity via PUT /identity.
  const record = await getIntegrationRecord(restaurant.id);
  if (record) {
    await upsertIntegrationIdentity({ restaurantId: restaurant.id, heartbeat: true });
  }

  return Response.json({
    ok: true,
    restaurant: { ...restaurant, marketplaceId },
  });
}