import { NextRequest } from "next/server";
import {
  getIntegrationRecord,
  getOrCreateMarketplaceId,
  MarketplaceIdTakenError,
  recordIntegrationAudit,
  syncMarketplaceId,
  upsertIntegrationIdentity,
} from "@/db/queries";
import { setWebhookContext } from "@/db/menu-sync";
import { sealWebhookSecret } from "@/lib/webhook-crypto";
import { requireIntegrationAuth } from "../_auth";

export const dynamic = "force-dynamic";

/**
 * An id field that is either a real value or UNCHANGED.
 *
 * `undefined` is meaningful: `upsertIntegrationIdentity` treats it as "keep the
 * stored value" and `null` as "clear it". Returning `null` for a missing field
 * is what wiped the claimed POS identity before.
 */
function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : undefined;
}

/** Same contract as `optionalId`: `undefined` means "leave the status alone". */
function optionalStatus(value: unknown): "pending" | "active" | "disabled" | undefined {
  return value === "active" || value === "pending" || value === "disabled" ? value : undefined;
}

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
 *
 * Every field is OPTIONAL and an absent field is left exactly as it is. That is
 * what makes the endpoint idempotent, and getting it wrong was actively harmful
 * in both directions:
 *
 *   - `status` used to default to "pending" when the body omitted it, so any
 *     identity push from a connected POS silently downgraded a live integration.
 *     `hasActiveIntegration` went false, the production ordering gate started
 *     refusing checkout and `enqueueOrderDelivery` stopped journaling — the
 *     restaurant went offline without anyone disconnecting it.
 *   - `posRestaurantId` used to coerce an absent value to `null` rather than
 *     "unchanged", which wiped the identity the claim flow had just recorded
 *     and re-diverged it from `marketplace_id`.
 *
 * The endpoint also accepts `webhook_secret` so a POS whose claim response
 * omitted one can still activate: the record stays "pending" until the secret
 * is sealed here, and `hasActiveIntegration` treats a secretless record as not
 * deliverable.
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

  const posRestaurantId = optionalId(body.posRestaurantId);
  const posBranchId = optionalId(body.posBranchId);
  const posOutletId = optionalId(body.posOutletId);
  const status = optionalStatus(body.status);

  // Keep the shared external identity reconciled on every write that carries a
  // POS restaurant id. `order.restaurant_id` routes on marketplace_id and the
  // POS signs webhooks with its own external_restaurant_id, so the two have to
  // stay the same value or orders are delivered to a restaurant the POS does
  // not recognise.
  if (posRestaurantId) {
    try {
      await syncMarketplaceId(restaurant.id, posRestaurantId);
    } catch (err) {
      if (err instanceof MarketplaceIdTakenError) {
        return Response.json(
          {
            ok: false,
            error: "That POS restaurant id is already assigned to another listing",
            code: "MARKETPLACE_ID_TAKEN",
          },
          { status: 409 },
        );
      }
      throw err;
    }
  }

  const identity = await upsertIntegrationIdentity({
    restaurantId: restaurant.id,
    provider:
      typeof body.provider === "string" && body.provider.trim()
        ? body.provider.trim().slice(0, 40)
        : undefined,
    posRestaurantId,
    posBranchId,
    posOutletId,
    status,
    heartbeat: true,
    sync: true,
  });

  if (typeof body.webhook_secret === "string" && body.webhook_secret.trim()) {
    await setWebhookContext(restaurant.id, sealWebhookSecret(body.webhook_secret.trim()));
  }

  await recordIntegrationAudit(restaurant.id, "identity.upserted", { actor: "restaurant" }, {
    posRestaurantId: identity.posRestaurantId,
    posBranchId: identity.posBranchId,
    posOutletId: identity.posOutletId,
    provider: identity.provider,
    status: identity.status,
  });

  return Response.json({
    ok: true,
    identity: {
      restaurant: { ...restaurant, marketplaceId: identity.marketplaceId },
      marketplaceId: identity.marketplaceId,
      record: identity,
    },
  });
}