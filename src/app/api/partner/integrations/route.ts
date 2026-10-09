import { NextRequest } from "next/server";
import {
  findPendingTransferFor,
  getIntegrationRecord,
  getRestaurantManageById,
  MarketplaceIdTakenError,
  recordIntegrationAudit,
  requestIntegrationTransfer,
  syncMarketplaceId,
  upsertIntegrationIdentity,
} from "@/db/queries";
import { setWebhookContext } from "@/db/menu-sync";
import { readJsonBody } from "@/lib/abuse";
import { claimPosConnection, PosBridgeError, type PosConnectionIdentity } from "@/lib/pos-bridge";
import { requirePartnerSession } from "@/lib/security/restaurant-session";
import { sealWebhookSecret } from "@/lib/webhook-crypto";

export const dynamic = "force-dynamic";

/**
 * The restaurant is resolved from the session, from nothing else. This route used
 * to accept an owner key from the `x-owner-key` header *or* the request body — a
 * convenience that meant the full-control credential was also being written into
 * bodies and logged wherever bodies are logged. The session is attached by the
 * browser; there is no credential left here to send.
 */
async function bodyOf(req: NextRequest): Promise<Record<string, unknown>> {
  // Through the shared 16 KB capped reader: parsing the request body directly
  // honours only the declared `content-length`, which a chunked body does not
  // send. A refused body lands here as `{}`, and the field checks below turn
  // that into a 400.
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return {};
  const value: unknown = parsed.body;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * MARKETPLACE_ID_TAKEN, made recoverable.
 *
 * `restaurants.marketplace_id` is UNIQUE, so a POS that reconnects under a new
 * listing while its identity is still held elsewhere cannot complete a claim.
 * The refusal was correct; what made it a dead end is *when* it fires — after
 * the POS redeemed its single-use connection code. The operator was left with a
 * burned code, no recourse, and the only fix an engineer could apply by editing
 * `restaurants.marketplace_id` by hand.
 *
 * So instead of refusing and discarding, this:
 *
 *   1. Keeps the claim. The identity and its sealed webhook secret are written to
 *      the requester's record as PENDING — the same non-deliverable state a
 *      half-claim already uses, which the ordering gate treats as closed. The
 *      operator's burned code still bought something: approval can finish the
 *      connection without them going back to the POS for a new one.
 *   2. Raises a transfer request naming the listing that holds the identity, for
 *      ops to approve or deny.
 *   3. Reports both the holder and any open request, so the UI can explain the
 *      conflict instead of showing one flat error string.
 *
 * Still a 409: the connection genuinely has not been made, and a caller that
 * only checks `ok` must not read this as success.
 */
async function openTransferRequest(input: {
  restaurantId: number;
  holderId: number;
  identity: PosConnectionIdentity | null;
  ipAddress: string | null;
}): Promise<Response> {
  const { restaurantId, holderId, identity, ipAddress } = input;
  const contestedId = String(identity?.external_restaurant_id ?? "").trim();

  // Preserve the claim before anything else. Every step after this point is
  // reporting; this is the only one that cannot be reconstructed later, because
  // the POS will not hand the secret over twice.
  const sealedSecret = identity?.webhook_secret
    ? sealWebhookSecret(identity.webhook_secret)
    : null;
  if (contestedId) {
    await upsertIntegrationIdentity({
      restaurantId,
      provider: "restaurant-ai",
      posRestaurantId: contestedId,
      posBranchId: identity?.branch?.id ?? null,
      posOutletId: identity?.external_outlet_id ?? null,
      // Deliberately never "active": the id is not ours yet, and a record
      // marked active opens checkout for orders that cannot be routed.
      status: "pending",
      sync: true,
    });
    // After the upsert, so the UPDATE scoped to restaurant_id matches a row.
    if (sealedSecret) await setWebhookContext(restaurantId, sealedSecret);
  }

  let request = null;
  let holder = null;
  if (contestedId) {
    try {
      request = await requestIntegrationTransfer({
        requestedByRestaurantId: restaurantId,
        previousRestaurantId: holderId,
        marketplaceId: contestedId,
        posRestaurantId: contestedId,
        ipAddress,
      });
      holder = request.heldBy;
    } catch (e) {
      // The request is a convenience; the refusal below is still true without
      // it. Never let a queue hiccup turn a clear conflict into a 500.
      console.error("integration transfer request failed", e);
    }
  }

  await recordIntegrationAudit(
    restaurantId,
    "pos_integration_transfer_requested",
    { actor: "partner", ipAddress },
    { marketplace_id: contestedId, held_by: holderId, request_id: request?.id ?? null },
  );

  const holderName = holder ? `“${holder.name}”` : "another listing";
  return Response.json(
    {
      ok: false,
      error: contestedId
        ? `This POS is still linked to ${holderName}. Request the transfer and our team will move it across.`
        : "That POS restaurant is already connected to another listing",
      code: "MARKETPLACE_ID_TAKEN",
      transfer: {
        requested: !!request,
        requestId: request?.id ?? null,
        heldBy: holder,
        marketplaceId: contestedId,
      },
    },
    { status: 409 },
  );
}

/** Current POS integration record for the signed-in partner's listing. */
export async function GET(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: false });
  if (!auth.ok) return auth.response;
  const restaurantId = auth.session.restaurantId;

  const restaurant = await getRestaurantManageById(restaurantId);
  if (!restaurant) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

  const record = await getIntegrationRecord(restaurantId);
  // Carried on GET as well so the UI can still show "transfer requested" after a
  // reload or on another tab. The claim response is where it is created, but the
  // operator's next visit is a page load.
  const transfer = record?.posRestaurantId ? await findPendingTransferFor(restaurantId) : null;
  return Response.json({ ok: true, restaurant, record, transfer });
}

/**
 * Connect (or reconnect) the signed-in listing to the POS by claiming a POS-issued
 * connection code. The POS redeems the code exactly once; the Marketplace then
 * records the one-to-one identity (restaurant / branch / outlet). Reconnecting
 * reuses the same external identity — the record is upserted, never duplicated.
 *
 * Redeeming a code is a write with real consequences (a listing becomes
 * orderable), so it takes the session's CSRF check and write budget rather than
 * the owner key's implicit preflight protection.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const restaurantId = auth.session.restaurantId;

  const body = await bodyOf(req);
  const connectionCode = String(body?.connection_code ?? "").trim();

  if (!connectionCode) {
    return Response.json({ ok: false, error: "connection_code is required" }, { status: 400 });
  }

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;

  // Hoisted out of the try: the MARKETPLACE_ID_TAKEN handler below still needs
  // the identity the POS just handed over, and by then the connection code has
  // already been redeemed. That claimed identity is the only copy of the
  // webhook secret, so losing it here is what turned a recoverable conflict
  // into a dead end — the operator would have to mint a brand new code.
  let identity: PosConnectionIdentity | null = null;

  try {
    identity = await claimPosConnection(connectionCode);
    // The shared external identity must be one value on both sides: the POS
    // routes payloads by order.restaurant_id and signs webhooks with its own
    // external_restaurant_id, both of which must equal this marketplace_id.
    //
    // Checked for a collision before any write, because the code is already
    // consumed at this point — a generic failure here strands the operator with
    // a burned code and nothing to retry with.
    await syncMarketplaceId(restaurantId, identity.external_restaurant_id ?? "");

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

    // ORDER MATTERS: the record must exist before the secret is written.
    // `setWebhookContext` is an UPDATE scoped to restaurant_id, so running it
    // first matched zero rows on a first-time connect and the sealed secret was
    // silently dropped — leaving a record that said `active` (because
    // `deliverable` was computed from the local variable) while storing no
    // secret. `hasActiveIntegration` then read false and the ordering gate
    // refused every checkout with INTEGRATION_NOT_CONNECTED.
    const record = await upsertIntegrationIdentity({
      restaurantId,
      provider: "restaurant-ai",
      posRestaurantId: identity.external_restaurant_id,
      posBranchId: identity.branch?.id ?? null,
      posOutletId: identity.external_outlet_id ?? null,
      status: deliverable ? "active" : "pending",
      sync: true,
    });
    if (sealedSecret) await setWebhookContext(restaurantId, sealedSecret);

    // Re-read instead of returning the upsert's DTO. The upsert ran BEFORE the
    // secret was sealed, so its readiness was computed against a record that did
    // not have one yet — it reported `status: "active"` together with
    // `notReadyReason: "webhook_secret"`, telling the restaurant orders were
    // blocked on a connection that was in fact deliverable. That self-contradiction
    // is exactly what this panel exists to eliminate, so the response has to
    // describe committed state.
    const current = (await getIntegrationRecord(restaurantId)) ?? record;

    await recordIntegrationAudit(
      restaurantId,
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
          record: current,
          connected: false,
          code: "PENDING_INTEGRATION_SECRET",
          error: identity.webhook_secret
            ? "The POS did not return a restaurant id, so orders cannot be routed to it yet."
            : "The POS did not return a webhook secret, so orders cannot be signed and sent yet. Reconnect once the POS shares one.",
        },
        { status: 202 },
      );
    }

    return Response.json({ ok: true, record: current });
  } catch (err) {
    if (err instanceof MarketplaceIdTakenError) {
      return await openTransferRequest({
        restaurantId,
        holderId: err.ownedByRestaurantId,
        identity,
        ipAddress,
      });
    }
    if (err instanceof PosBridgeError) {
      if (err.status === 409 && err.code === "ALREADY_REDEEMED") {
        const existing = await getIntegrationRecord(restaurantId);
        const codeIdentity = String(err.payload?.external_restaurant_id ?? "");
        if (existing && existing.status === "active" && codeIdentity === existing.posRestaurantId) {
          // Idempotent redirect: the same POS identity was already claimed.
          await syncMarketplaceId(restaurantId, codeIdentity);
          return Response.json({ ok: true, record: existing, already: true });
        }
        return Response.json(
          {
            ok: false,
            error:
              "That code was already redeemed for a different POS restaurant. Create a new code in the POS for this location — do not reuse one you received elsewhere.",
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
              : // Never the remote's own wording: this body reaches a client, and
                // the status plus `err.code` already carry the diagnosis.
                "The POS rejected the connection code";
      return Response.json({ ok: false, error: message, code: err.code }, { status: err.status });
    }
    return Response.json({ ok: false, error: "Could not connect the POS" }, { status: 500 });
  }
}

/**
 * Disconnect the POS for the signed-in listing. History (orders, audit, identity
 * records) is preserved — only the connection record is disabled.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const restaurantId = auth.session.restaurantId;

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;

  // Guarded so disconnecting a listing that was never connected is a no-op
  // rather than an upsert: the previous unconditional write INSERTED a disabled
  // record with null ids, and the console then reported "Disconnected" for a
  // listing that had never been connected at all.
  const existing = await getIntegrationRecord(restaurantId);
  if (!existing) {
    return Response.json({ ok: true, record: null, already: true });
  }

  const record = await upsertIntegrationIdentity({
    restaurantId,
    status: "disabled",
  });
  await recordIntegrationAudit(
    restaurantId,
    "pos_integration_disconnect",
    { actor: "partner", ipAddress },
    { pos_restaurant_id: record.posRestaurantId },
  );
  return Response.json({ ok: true, record });
}
