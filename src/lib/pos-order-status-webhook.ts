import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getRestaurantIdByMarketplaceId, getWebhookContext } from "@/db/menu-sync";
import { applyOrderStatusTransition } from "@/db/pos-delivery";
import { mapPosEventToMarketplaceStatus } from "@/integrations/pos/order-status";
import { handleCancelledOrderPayment } from "@/integrations/payments/refund";
import {
  computeWebhookSignature,
  menuWebhookTimestampValid,
  openWebhookSecret,
  webhookSignaturesEqual,
} from "@/lib/webhook-crypto";

/**
 * Single verified handler backing all four POS status webhook paths
 * (order-status / order-accepted / order-rejected / order-cancelled). The POS
 * outbox treats ANY 2xx as delivered and ANY non-2xx as requeueable — so a
 * verified-but-not-applicable webhook MUST return 200 (skipped) to converge,
 * while a genuine auth failure (401) or an unknown tenant (403) is a real
 * configuration error the POS should keep surfacing.
 *
 * Replays are idempotent on `event_id` (deterministic per POS order+status):
 * the first sighting flips `orders.integration_status` forward; every later
 * replay resolves without mutation. POS vocabulary is translated to canonical
 * Marketplace statuses via the Phase 5 source of truth (order-status.ts).
 */

type JsonObject = Record<string, unknown>;

export async function handlePosOrderStatusWebhook(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();

  const integrationId = (req.headers.get("x-integration-id") ?? "").trim();
  const tsHeader = (req.headers.get("x-timestamp") ?? "").trim();
  const signature = (req.headers.get("x-signature") ?? "").trim();

  const restaurantId = await getRestaurantIdByMarketplaceId(integrationId);
  const restaurantValid = restaurantId !== null;

  const context = restaurantId ? await getWebhookContext(restaurantId) : null;
  let secret: string | null = null;
  if (context?.webhookSecret) {
    try {
      secret = openWebhookSecret(context.webhookSecret);
    } catch {
      secret = null;
    }
  }

  const expected = secret
    ? computeWebhookSignature(secret, integrationId, tsHeader, rawBody)
    : null;
  const signatureValid =
    !!secret && !!signature && !!expected && webhookSignaturesEqual(signature, expected);
  const timestampValid = menuWebhookTimestampValid(tsHeader);

  const diag = { signatureValid, timestampValid, restaurantValid };

  // Spoofed / unknown tenant → 403 so the acceptance contract holds: a
  // restaurant that doesn't exist on this Marketplace is a hard rejection,
  // distinguishable from a wrong-signature (401) on a known tenant.
  if (!restaurantValid) {
    return Response.json(
      {
        ok: false,
        received: true,
        verified: false,
        deduplicated: false,
        applied: false,
        error: "unknown_marketplace_id",
        _diag: diag,
      },
      { status: 403 },
    );
  }

  // Wrong secret / replay / stale timestamp → 401 for a known tenant.
  if (!signatureValid || !timestampValid) {
    return Response.json(
      {
        ok: false,
        received: true,
        verified: false,
        deduplicated: false,
        applied: false,
        error: "invalid_signature",
        _diag: diag,
      },
      { status: 401 },
    );
  }

  const body = parseBody(rawBody);
  if (!body) {
    return Response.json(
      { ok: false, received: true, verified: true, error: "invalid_json" },
      { status: 400 },
    );
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : null;
  const externalOrderId = typeof body.external_order_id === "string" ? body.external_order_id : null;
  const posOrderId = body.pos_order_id == null ? null : Number(body.pos_order_id);

  // The POS omits `status` on `order.rejected` / `order.cancelled`; the event
  // name carries it. See mapPosEventToMarketplaceStatus for why reading
  // `body.status` alone silently dropped both routes.
  const eventName = typeof body.event === "string" ? body.event : null;
  const status = mapPosEventToMarketplaceStatus(eventName, body.status);
  // Phase 7 — optional branch/outlet claims on the frame. The Marketplace's own
  // outbound status webhooks never send these; they're read so a forged frame
  // claiming a foreign branch/outlet is rejected inside the transition.
  const outletId = typeof body.outlet_id === "string" && body.outlet_id ? body.outlet_id : null;
  const branchId = typeof body.branch_id === "string" && body.branch_id ? body.branch_id : null;
  const payloadHash = createHash("sha256").update(rawBody || "").digest("hex");

  if (!eventId || !externalOrderId || !status) {
    // Never punish a verified-but-malformed frame with a retry loop: converge.
    return Response.json({
      ok: true,
      received: true,
      verified: true,
      deduplicated: false,
      applied: false,
      skipped: true,
      skippedReason: "MISSING_FIELDS",
      event: eventName,
      _diag: diag,
    });
  }

  // Idempotent, forward-only transition inside one transaction.
  const result = await applyOrderStatusTransition({
    restaurantId: restaurantId!,
    eventId,
    externalOrderId,
    posOrderId: Number.isFinite(posOrderId) ? posOrderId : null,
    status,
    outletId,
    branchId,
    payloadHash,
  });

  // Same event_id, different payload: acknowledge (2xx — the POS outbox must
  // converge, never loop) but surface the conflict explicitly.
  if (result.outcome === "replay_conflict") {
    return Response.json({
      ok: true,
      received: true,
      verified: true,
      deduplicated: true,
      replay_conflict: true,
      applied: false,
      event_id: eventId,
      external_order_id: externalOrderId,
      integration_status: status,
      _diag: diag,
    });
  }

  if (result.outcome === "duplicate") {
    return Response.json({
      ok: true,
      received: true,
      verified: true,
      deduplicated: true,
      applied: false,
      event_id: eventId,
      external_order_id: externalOrderId,
      integration_status: status,
      _diag: diag,
    });
  }

  if (result.outcome === "skipped") {
    return Response.json({
      ok: true,
      received: true,
      verified: true,
      deduplicated: false,
      applied: false,
      skipped: true,
      skippedReason: result.reason,
      current_status: result.current,
      requested_status: result.next,
      event_id: eventId,
      external_order_id: externalOrderId,
      _diag: diag,
    });
  }

  // Cancellation is the POS-owned money-return trigger: once the status is
  // applied, close/refund the payment. Fire-and-forget — the response must not
  // block on a provider refund call, and handleCancelledOrderPayment is
  // idempotent (PAYMENT_PENDING/UNPAID close, captured money gates REFUND_
  // PENDING + provider refund, replays are no-ops).
  if (result.outcome === "applied" && status === "CANCELLED") {
    void handleCancelledOrderPayment(restaurantId!, externalOrderId, "ORDER_CANCELLED").catch((e) => {
      console.error("[pos-order-status] refund orchestration failed", e);
    });
  }

  // The POS explains a rejection/cancellation in fields we were dropping on the
  // floor: `reason` is the standardised code, `initiated_by` separates a
  // restaurant-driven cancel from a customer one, and `previous_status` is the
  // stage being left behind. Echo them back so the applied response is
  // diagnosable without re-reading the POS outbox.
  const reason = typeof body.reason === "string" && body.reason ? body.reason : null;
  const initiatedBy =
    typeof body.initiated_by === "string" && body.initiated_by ? body.initiated_by : null;
  const previousStatus =
    typeof body.previous_status === "string" && body.previous_status ? body.previous_status : null;

  return Response.json({
    ok: true,
    received: true,
    verified: true,
    deduplicated: false,
    applied: true,
    source: "pos",
    event: eventName,
    event_id: eventId,
    external_order_id: externalOrderId,
    pos_order_id: posOrderId,
    integration_status: status,
    reason,
    initiated_by: initiatedBy,
    previous_status: previousStatus,
    status_updated_at: new Date().toISOString(),
    _diag: diag,
  });
}

function parseBody(raw: string): JsonObject | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as JsonObject;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}