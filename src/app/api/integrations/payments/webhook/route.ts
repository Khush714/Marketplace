import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  applyProviderPaymentEvent,
  type RazorpayPaymentEntity,
  type RazorpayRefundEntity,
} from "@/db/payments";
import { enqueuePaymentDelivery, coordinateCaptureDelivery } from "@/integrations/pos/payment-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Provider (Razorpay) payment webhook — the authoritative money-received
 * signal for the Marketplace. Security contract (Phase 6):
 *   1. HMAC-SHA256 over the EXACT raw body bytes, header x-razorpay-signature
 *      (the same frame POS razorpay.js verifies).
 *   2. event_id (the Razorpay webhook's body.id) idempotency — first sighting
 *      wins, replays resolve as dedup without re-applying money transitions.
 *   3. amount (paise) + currency are verified against the ORDER row inside
 *      applyProviderPaymentEvent; a mismatch never becomes PAID.
 *   4. payment is resolved by provider_payment_id — the order/restaurant are
 *      derived from the recorded payment row, never from webhook notes.
 * Nothing customer-secret (card, CVV, UPI id) is ever logged or returned.
 * Non-2xx responses make Razorpay retry; the whole path is idempotent.
 */

const RAZORPAY_WEBHOOK_SECRET_ENV = "RAZORPAY_WEBHOOK_SECRET";
const WEBHOOK_WINDOW_MS = 60_000;
const WEBHOOK_MAX_PER_WINDOW = 120;

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function webhookSecret(): string | null {
  const secret = process.env[RAZORPAY_WEBHOOK_SECRET_ENV] ?? "";
  return secret.trim() || null;
}

// In-process sliding-window rate limiter (per source IP). Rebuilt on restart;
// sufficient for the webhook path where the DB ledger is the durable gate.
const requestWindows = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - WEBHOOK_WINDOW_MS;
  const times = (requestWindows.get(ip) ?? []).filter((t) => t > cutoff);
  if (times.length >= WEBHOOK_MAX_PER_WINDOW) {
    requestWindows.set(ip, times);
    return true;
  }
  times.push(now);
  requestWindows.set(ip, times);
  return false;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}

type JsonObject = Record<string, unknown>;

export async function POST(req: NextRequest): Promise<Response> {
  const secret = webhookSecret();
  if (!secret) {
    return Response.json({ success: false, error: "RAZORPAY_WEBHOOK_SECRET not configured" }, { status: 503 });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return Response.json({ success: false, error: "rate_limited" }, { status: 429 });
  }

  const rawBody = await req.text();
  if (!rawBody) {
    return Response.json({ success: false, error: "missing body" }, { status: 400 });
  }

  const signature = (req.headers.get("x-razorpay-signature") ?? "").trim();
  if (!signature) {
    return Response.json({ success: false, error: "missing signature" }, { status: 400 });
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!timingSafeEqualHex(expected, signature)) {
    return Response.json({ success: false, error: "invalid signature" }, { status: 400 });
  }

  let body: JsonObject;
  try {
    body = JSON.parse(rawBody) as JsonObject;
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return Response.json({ success: false, error: "invalid_json" }, { status: 400 });
  }

  const eventId = typeof body.id === "string" ? body.id : null;
  const eventType = typeof body.event === "string" ? body.event : null;
  if (!eventId || !eventType) {
    // Verified frame with unparseable identity — acknowledge so the provider
    // stops retrying; there is nothing to apply.
    return Response.json({ success: true, received: true, skipped: true, skippedReason: "MISSING_EVENT_ID_OR_TYPE" });
  }

  const isRefund = eventType.startsWith("refund.");
  const payload = (body.payload ?? {}) as JsonObject;
  const subPayload = isRefund ? payload["refund"] : payload["payment"];
  const entity = (
    subPayload && typeof subPayload === "object" ? (subPayload as JsonObject)["entity"] : undefined
  ) as RazorpayPaymentEntity | RazorpayRefundEntity | undefined;
  if (!entity || typeof entity !== "object") {
    return Response.json({ success: true, received: true, skipped: true, skippedReason: "NO_ENTITY" });
  }

  // Refund events are keyed on the REFUND id (not the webhook event id) so two
  // different provider events for the same refund can never double-count it.
  // Payment events keep the webhook id — retries of one capture are stable.
  const resolvedEventId = isRefund
    ? `rzp:refund:${(entity as RazorpayRefundEntity).id ?? eventId}`
    : `rzp:${eventId}:${eventType}`;

  const result = await applyProviderPaymentEvent({ eventId: resolvedEventId, eventType, entity, rawBody });

  // Same event_id, different bytes: acknowledge so the provider stops retrying,
  // but surface the conflict explicitly (the POS outbox must converge, not loop).
  if (result.outcome === "replay_conflict") {
    return Response.json({
      success: true,
      received: true,
      verified: true,
      deduplicated: true,
      replay_conflict: true,
      event_id: eventId,
    });
  }

  if (result.outcome === "duplicate") {
    return Response.json({ success: true, received: true, verified: true, deduplicated: true, event_id: eventId });
  }

  if (result.outcome === "ignored") {
    return Response.json({
      success: true,
      received: true,
      verified: true,
      deduplicated: false,
      applied: false,
      skipped: true,
      skippedReason: result.reason,
      event_id: eventId,
    });
  }

  // Applied — push money events to the POS through the bridge.
  if (result.deliverToPos && eventType === "payment.captured") {
    const p = result.payment;
    await coordinateCaptureDelivery({
      id: p.id,
      orderId: p.orderId,
      reference: p.reference,
      externalOrderId: p.externalOrderId,
      restaurantId: p.restaurantId,
      providerPaymentId: p.providerPaymentId,
      amountCents: p.amountCents,
      currency: p.currency,
      method: p.method,
    });
  } else if (result.deliverToPos && eventType.startsWith("refund.")) {
    const p = result.payment;
    const refundEntity = entity as RazorpayRefundEntity;
    await enqueuePaymentDelivery({
      paymentId: p.id,
      externalOrderId: p.externalOrderId,
      restaurantId: p.restaurantId,
      eventType: "refund.completed",
      eventId: `${p.reference}:refund.completed:${refundEntity.id}`,
      payload: {
        refund: {
          id: refundEntity.id,
          amountCents: refundEntity.amount ?? 0,
          totalRefundedCents: p.refundedAmountCents,
          reason: null,
          status: "COMPLETED",
        },
      },
    }).catch((e) => {
      console.error("[payments-webhook] refund delivery enqueue failed", e);
    });
  }

  return Response.json({
    success: true,
    received: true,
    verified: true,
    deduplicated: false,
    applied: true,
    event_id: eventId,
    event_type: eventType,
    payment_reference: result.payment.reference,
    payment_status: result.payment.status,
  });
}