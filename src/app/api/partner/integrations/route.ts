import { NextRequest } from "next/server";
import { getIntegrationRecord, getRestaurantByOwnerKey, recordIntegrationAudit, syncMarketplaceId, upsertIntegrationIdentity } from "@/db/queries";
import { setWebhookContext } from "@/db/menu-sync";
import { claimPosConnection, PosBridgeError } from "@/lib/pos-bridge";
import { sealWebhookSecret } from "@/lib/webhook-crypto";

export const dynamic = "force-dynamic";

function ownerKeyOf(req: NextRequest): string {
  // Phase 7 — ownerKey rides a header, never a URL query.
  return String(req.headers.get("x-owner-key") ?? "").trim();
}

async function bodyOf(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requireOwnerKey(ownerKey: string) {
  if (!ownerKey) return Response.json({ ok: false, error: "ownerKey is required" }, { status: 400 });
  return null;
}

/** Current POS integration record for an owner's listing. */
export async function GET(req: NextRequest) {
  const ownerKey = ownerKeyOf(req);
  const missing = requireOwnerKey(ownerKey);
  if (missing) return missing;

  const restaurant = await getRestaurantByOwnerKey(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });

  const record = await getIntegrationRecord(restaurant.id);
  return Response.json({ ok: true, restaurant, record });
}

/**
 * Connect (or reconnect) an owner's listing to the POS by claiming a POS-issued
 * connection code. The POS redeems the code exactly once; the Marketplace then
 * records the one-to-one identity (restaurant / branch / outlet). Reconnecting
 * reuses the same external identity — the record is upserted, never duplicated.
 */
export async function POST(req: NextRequest) {
  const body = await bodyOf(req);
  const ownerKey = String(body?.ownerKey ?? "").trim();
  const connectionCode = String(body?.connection_code ?? "").trim();

  if (!ownerKey || !connectionCode) {
    return Response.json(
      { ok: false, error: "ownerKey and connection_code are required" },
      { status: 400 },
    );
  }

  const restaurant = await getRestaurantByOwnerKey(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;

  try {
    const identity = await claimPosConnection(connectionCode);
    // The shared external identity must be one value on both sides: the POS
    // routes payloads by order.restaurant_id and signs webhooks with its own
    // external_restaurant_id, both of which must equal this marketplace_id.
    await syncMarketplaceId(restaurant.id, identity.external_restaurant_id ?? "");
    const record = await upsertIntegrationIdentity({
      restaurantId: restaurant.id,
      provider: "restaurant-ai",
      posRestaurantId: identity.external_restaurant_id,
      posBranchId: identity.branch?.id ?? null,
      posOutletId: identity.external_outlet_id ?? null,
      status: "active",
      sync: true,
    });
    if (identity.webhook_secret) {
      await setWebhookContext(restaurant.id, sealWebhookSecret(identity.webhook_secret));
    }
    await recordIntegrationAudit(
      restaurant.id,
      "pos_integration_connect",
      { actor: "partner", ipAddress },
      {
        pos_restaurant_id: identity.external_restaurant_id,
        pos_branch_id: identity.branch?.id ?? null,
        pos_outlet_id: identity.external_outlet_id ?? null,
      },
    );
    return Response.json({ ok: true, record });
  } catch (err) {
    if (err instanceof PosBridgeError) {
      if (err.status === 409 && err.code === "ALREADY_REDEEMED") {
        const existing = await getIntegrationRecord(restaurant.id);
        const codeIdentity = String(err.payload?.external_restaurant_id ?? "");
        if (existing && existing.status === "active" && codeIdentity === existing.posRestaurantId) {
          // Idempotent redirect: the same POS identity was already claimed.
          await syncMarketplaceId(restaurant.id, codeIdentity);
          return Response.json({ ok: true, record: existing, already: true });
        }
        return Response.json(
          {
            ok: false,
            error: "This code has already been redeemed for a different POS restaurant",
            code: "ALREADY_REDEEMED",
          },
          { status: 409 },
        );
      }
      const message =
        err.status === 401
          ? "Code is invalid or has expired"
          : err.status === 409
            ? "Connection not accepted by the POS"
            : err.status === 502 || err.status === 503
              ? "The POS is unreachable — try again"
              : err.message;
      return Response.json({ ok: false, error: message, code: err.code }, { status: err.status });
    }
    return Response.json({ ok: false, error: "Could not connect the POS" }, { status: 500 });
  }
}

/**
 * Disconnect the POS for an owner's listing. History (orders, audit, identity
 * records) is preserved — only the connection record is disabled.
 */
export async function DELETE(req: NextRequest) {
  const body = await bodyOf(req);
  const ownerKey = String(body?.ownerKey ?? "").trim();
  if (!ownerKey) {
    return Response.json({ ok: false, error: "ownerKey is required" }, { status: 400 });
  }

  const restaurant = await getRestaurantByOwnerKey(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const record = await upsertIntegrationIdentity({
    restaurantId: restaurant.id,
    status: "disabled",
  });
  await recordIntegrationAudit(
    restaurant.id,
    "pos_integration_disconnect",
    { actor: "partner", ipAddress },
    { pos_restaurant_id: record.posRestaurantId },
  );
  return Response.json({ ok: true, record });
}