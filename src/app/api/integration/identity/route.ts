import { NextRequest } from "next/server";
import {
  getIntegrationRecord,
  getOrCreateMarketplaceId,
  recordIntegrationAudit,
  upsertIntegrationIdentity,
} from "@/db/queries";
import { requireIntegrationAuth } from "../_auth";

export const dynamic = "force-dynamic";

/** GET /api/integration/identity — the restaurant's identity chain. */
export async function GET(req: NextRequest) {
  const restaurant = await requireIntegrationAuth(req);
  if (!restaurant) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const marketplaceId = await getOrCreateMarketplaceId(restaurant.id);
  const record = await getIntegrationRecord(restaurant.id);

  return Response.json({
    ok: true,
    identity: {
      restaurant: { ...restaurant, marketplaceId },
      marketplaceId,
      record,
    },
  });
}

/**
 * PUT /api/integration/identity — set or refresh the POS side of the identity
 * chain (POS Restaurant → Branch → Outlet). Additive and idempotent.
 */
export async function PUT(req: NextRequest) {
  const restaurant = await requireIntegrationAuth(req);
  if (!restaurant) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const marketplaceId = await getOrCreateMarketplaceId(restaurant.id);
  const identity = await upsertIntegrationIdentity({
    restaurantId: restaurant.id,
    provider: typeof body.provider === "string" ? body.provider.slice(0, 40) : "restaurant-ai",
    posRestaurantId: typeof body.posRestaurantId === "string" ? body.posRestaurantId.slice(0, 64) : null,
    posBranchId: typeof body.posBranchId === "string" ? body.posBranchId.slice(0, 64) : undefined,
    posOutletId: typeof body.posOutletId === "string" ? body.posOutletId.slice(0, 64) : undefined,
    status: body.status === "active" ? "active" : body.status === "disabled" ? "disabled" : "pending",
    heartbeat: true,
    sync: true,
  });

  await recordIntegrationAudit(restaurant.id, "identity.upserted", { actor: "restaurant" }, {
    posRestaurantId: identity.posRestaurantId,
    posBranchId: identity.posBranchId,
    posOutletId: identity.posOutletId,
    provider: identity.provider,
  });

  return Response.json({
    ok: true,
    identity: {
      restaurant: { ...restaurant, marketplaceId },
      marketplaceId,
      record: identity,
    },
  });
}