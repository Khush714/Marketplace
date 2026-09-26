import { getOrderByCode, recordIntegrationAudit } from "@/db/queries";
import {
  applyProviderPaymentEvent,
  getActivePaymentByOrder,
  type RazorpayPaymentEntity,
} from "@/db/payments";
import { coordinateCaptureDelivery } from "@/integrations/pos/payment-bridge";
import {
  fetchProviderPayment,
  providerMode,
  verifyCheckoutSignature,
} from "@/integrations/payments/provider-session";
import { readOrderToken, verifyOrderToken } from "@/lib/order-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Confirm a checkout attempt for an order that is awaiting payment.
 *
 * This is the browser handing back what checkout.js returned. It is NOT treated
 * as a claim:
 *   - the returned triple is signature-verified with the provider secret, so a
 *     client cannot forge it;
 *   - the money facts (status, amount, currency, method) are then re-read from
 *     the provider — the client's copy is never trusted for the transition;
 *   - the webhook remains the authority, and a repeat call is a no-op because
 *     the ledger event id is derived from the provider payment id.
 *
 * Without this route a lost or slow webhook would leave a paid customer staring
 * at a pending screen until reconciliation notices 24h later.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!verifyOrderToken(code, readOrderToken(req.headers))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const order = await getOrderByCode(code);
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });

  const payment = await getActivePaymentByOrder(order.id);
  if (!payment) return Response.json({ error: "No payment for this order" }, { status: 404 });

  if (payment.status === "PAID") {
    return Response.json({ ok: true, status: "PAID", reference: payment.reference });
  }
  if (payment.status !== "PAYMENT_PENDING") {
    return Response.json({ ok: false, status: payment.status, error: "Payment is no longer payable" }, { status: 409 });
  }

  const mode = providerMode();
  if (mode === "unavailable") {
    return Response.json({ ok: false, error: "Payments are not configured" }, { status: 503 });
  }

  let body: {
    razorpay_payment_id?: unknown;
    razorpay_order_id?: unknown;
    razorpay_signature?: unknown;
    dev?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  // Local stand-in provider: no keys are configured, so there is no real money
  // and no real signature to check. `providerMode()` can only be "dev" outside
  // production, and the order token still gates the call.
  if (mode === "dev") {
    if (body.dev !== true) {
      return Response.json({ ok: false, error: "Missing dev confirmation" }, { status: 400 });
    }
    const applied = await applyProviderPaymentEvent({
      eventId: `dev:${payment.reference}:payment.captured`,
      eventType: "payment.captured",
      entity: {
        id: `dev_pay_${payment.reference}`,
        amount: payment.amountCents,
        currency: payment.currency,
        status: "captured",
        method: order.paymentMethod,
        order_id: payment.providerOrderId,
      } satisfies RazorpayPaymentEntity,
    });
    await afterApply(applied, payment);
    return Response.json({
      ok: true,
      status: applied.outcome === "applied" ? applied.payment.status : payment.status,
      reference: payment.reference,
      mode,
    });
  }

  const providerOrderId = String(body.razorpay_order_id ?? "").trim();
  const providerPaymentId = String(body.razorpay_payment_id ?? "").trim();
  const signature = String(body.razorpay_signature ?? "").trim();
  if (!providerOrderId || !providerPaymentId || !signature) {
    return Response.json({ ok: false, error: "Incomplete checkout response" }, { status: 400 });
  }

  if (!verifyCheckoutSignature({ razorpayOrderId: providerOrderId, razorpayPaymentId: providerPaymentId, razorpaySignature: signature })) {
    await recordIntegrationAudit(order.restaurantId, "PAYMENT_EXCEPTION", { actor: "system" }, {
      order_id: order.id,
      external_order_id: order.externalOrderId,
      payment_reference: payment.reference,
      failure_code: "CHECKOUT_SIGNATURE_INVALID",
    });
    return Response.json({ ok: false, error: "Signature verification failed" }, { status: 400 });
  }

  // The signature proves "this payment belongs to that provider order" — it must
  // also be OUR order, or a valid payment from another checkout could be reused.
  if (!payment.providerOrderId || payment.providerOrderId !== providerOrderId) {
    return Response.json({ ok: false, error: "Payment does not belong to this order" }, { status: 409 });
  }

  // Money facts come from the provider, never from the request body.
  const remote = await fetchProviderPayment(providerPaymentId);
  if (!remote) {
    return Response.json({ ok: true, status: payment.status, pending: true }, { status: 202 });
  }
  if (remote.orderId && remote.orderId !== payment.providerOrderId) {
    return Response.json({ ok: false, error: "Payment does not belong to this order" }, { status: 409 });
  }

  if (remote.status === "authorized") {
    // Not captured yet: the capture webhook is what settles it.
    return Response.json({ ok: true, status: payment.status, pending: true }, { status: 202 });
  }

  const eventType = remote.status === "captured" ? "payment.captured" : "payment.failed";
  const applied = await applyProviderPaymentEvent({
    eventId: `rzp:checkout:${providerPaymentId}:${eventType}`,
    eventType,
    entity: {
      id: remote.id,
      amount: remote.amount,
      currency: remote.currency,
      status: remote.status,
      method: remote.method ?? undefined,
      order_id: remote.orderId ?? null,
      error_code: remote.errorCode,
      error_description: remote.errorDescription,
    } satisfies RazorpayPaymentEntity,
  });
  await afterApply(applied, payment);

  if (applied.outcome === "applied" && applied.payment.status === "FAILED") {
    return Response.json(
      { ok: false, status: "FAILED", error: remote.errorDescription ?? "Payment failed", reference: payment.reference },
      { status: 402 },
    );
  }
  return Response.json({
    ok: true,
    status: applied.outcome === "applied" ? applied.payment.status : payment.status,
    reference: payment.reference,
    mode,
  });
}

/** Mirror the webhook's behaviour: a verified capture must reach the POS. */
async function afterApply(
  applied: Awaited<ReturnType<typeof applyProviderPaymentEvent>>,
  payment: { id: number; orderId: number; reference: string; externalOrderId: string; restaurantId: number; providerPaymentId: string | null; amountCents: number; currency: string; method: string | null },
): Promise<void> {
  if (applied.outcome !== "applied" || !applied.deliverToPos) return;
  const p = applied.payment;
  await coordinateCaptureDelivery({
    id: p.id,
    orderId: applied.orderId,
    reference: p.reference,
    externalOrderId: p.externalOrderId,
    restaurantId: p.restaurantId,
    providerPaymentId: p.providerPaymentId,
    amountCents: p.amountCents,
    currency: p.currency,
    method: p.method,
  });
}
