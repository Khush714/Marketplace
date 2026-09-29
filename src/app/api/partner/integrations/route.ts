import { NextRequest } from "next/server";
import { getIntegrationRecord, getRestaurantByOwnerKey, MarketplaceIdTakenError, recordIntegrationAudit, syncMarketplaceId, upsertIntegrationIdentity } from "@/db/queries";
import { setWebhookContext } from "@/db/menu-sync";
import { claimPosConnection, PosBridgeError } from "@/lib/pos-bridge";
import { sealWebhookSecret } from "@/lib/webhook-crypto";

export const dynamic = "force-dynamic";

/**
 * The owner key is accepted from the `x-owner-key` header (preferred) or the
 * request body, so a client following either convention works against the whole
 * route. It never rides a URL query — query strings land in proxy and access
 * logs, and this is a full-control credential.
 */
async function ownerKeyOf(req: NextRequest, body: Record<string, unknown> = {}): Promise<string> {
  const fromHeader = String(req.headers.get("x-owner-key") ?? "").trim();
  if (fromHeader) return fromHeader;
  return String(body?.ownerKey ?? "").trim();
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
  const ownerKey = await ownerKeyOf(req);
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
  const ownerKey = await ownerKeyOf(req, body);
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
    //
    // Checked for a collision before any write, because the code is already
    // consumed at this point — a generic failure here strands the operator with
    // a burned code and nothing to retry with.
    await syncMarketplaceId(restaurant.id, identity.external_restaurant_id ?? "");

    // Seal the webhook secret BEFORE deciding the status. Delivery signs every
    // payload with it, so a record without one is not deliverable no matter what
    // the POS says its status is. Marking such a record ACTIVE was a money bug:
    // the ordering gate and the delivery journal both keyed off status alone, so
    // customers were charged for orders that could never be sent. A half-claim
    // stays PENDING and activates on the next identity push that carries the
    // secret.
    const sealedSecret = identity.webhook_secret
      ? sealWebhookSecret(identity.webhook_secret)
      : null;
    const deliverable = !!identity.external_restaurant_id && !!sealedSecret;
    if (sealedSecret) await setWebhookContext(restaurant.id, sealedSecret);

    const record = await upsertIntegrationIdentity({
      restaurantId: restaurant.id,
      provider: "restaurant-ai",
      posRestaurantId: identity.external_restaurant_id,
      posBranchId: identity.branch?.id ?? null,
      posOutletId: identity.external_outlet_id ?? null,
      status: deliverable ? "active" : "pending",
      sync: true,
    });
    await recordIntegrationAudit(
      restaurant.id,
      "pos_integration_connect",
      { actor: "partner", ipAddress },
      {
        pos_restaurant_id: identity.external_restaurant_id,
        pos_branch_id: identity.branch?.id ?? null,
        pos_outlet_id: identity.external_outlet_id ?? null,
        deliverable,
      },
    );

    if (!deliverable) {
      // The claim is recorded and the operator is not left guessing: say exactly
      // what the POS still has to send.
      return Response.json(
        {
          ok: true,
          record,
          connected: false,
          code: "PENDING_INTEGRATION_SECRET",
          error: identity.webhook_secret
            ? "The POS did not return a restaurant id, so orders cannot be routed to it yet."
            : "The POS did not return a webhook secret, so orders cannot be signed and sent yet. Reconnect once the POS shares one.",
        },
        { status: 202 },
      );
    }

    return Response.json({ ok: true, record });
  } catch (err) {
    if (err instanceof MarketplaceIdTakenError) {
      return Response.json(
        {
          ok: false,
          error: "That POS restaurant is already connected to another listing",
          code: "MARKETPLACE_ID_TAKEN",
        },
        { status: 409 },
      );
    }
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
  const ownerKey = await ownerKeyOf(req, body);
  if (!ownerKey) {
    return Response.json({ ok: false, error: "ownerKey is required" }, { status: 400 });
  }

  const restaurant = await getRestaurantByOwnerKey(ownerKey);
  if (!restaurant) return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;

  // Guarded so disconnecting a listing that was never connected is a no-op
  // rather than an upsert: the previous unconditional write INSERTED a disabled
  // record with null ids, and the console then reported "Disconnected" for a
  // listing that had never been connected at all.
  const existing = await getIntegrationRecord(restaurant.id);
  if (!existing) {
    return Response.json({ ok: true, record: null, already: true });
  }

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