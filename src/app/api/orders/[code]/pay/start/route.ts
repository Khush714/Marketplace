import { getOrderByCode, recordIntegrationAudit } from "@/db/queries";
import { bindProviderOrderId, getActivePaymentByOrder, isOnlinePayment } from "@/db/payments";
import { createProviderOrder, providerMode, razorpayKeyId } from "@/integrations/payments/provider-session";
import { readOrderToken, verifyOrderToken } from "@/lib/order-token";
import { guardWrite } from "@/lib/abuse";
import { apiError, notFound } from "@/lib/security/errors";

export const dynamic = "force-dynamic";

/**
 * Start (or re-start) provider checkout for an order that is still awaiting
 * payment. Idempotent: an order that already has a provider order returns the
 * same session instead of minting a second one, so a double tap, a refresh, or
 * a retry after a provider outage all converge on one payment.
 *
 * Budgeted before the token check: an unauthenticated caller gets the same 404
 * either way, but only one of those outcomes cost a provider call — and the
 * token gating this route is not a licence to grind provider quota (see
 * ABUSE_BUDGETS.paymentStart).
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const blocked = await guardWrite(req, "paymentStart");
  if (blocked) return blocked;

  const { code } = await ctx.params;
  if (!verifyOrderToken(code, readOrderToken(req.headers))) {
    return notFound("Not found");
  }

  const order = await getOrderByCode(code);
  if (!order) return notFound("Not found");

  if (!isOnlinePayment(order.paymentMethod)) {
    return apiError(409, "This order is not payable online");
  }

  const payment = await getActivePaymentByOrder(order.id);
  if (!payment) return apiError(409, "No payable payment for this order");

  if (payment.status === "PAID") {
    return Response.json({ ok: true, status: "PAID", alreadyPaid: true });
  }
  // FAILED is still payable: the customer declined once and is retrying
  // against the same provider order. Everything else (refunds, cancelled,
  // already captured) is genuinely no longer payable.
  if (payment.status !== "PAYMENT_PENDING" && payment.status !== "FAILED") {
    return apiError(409, "Payment is no longer payable", undefined, {
      details: { status: payment.status },
    });
  }

  const mode = providerMode();
  if (mode === "unavailable") {
    return apiError(503, "Payments are not configured", "PROVIDER_NOT_CONFIGURED");
  }

  if (payment.providerOrderId) {
    return Response.json({
      ok: true,
      status: payment.status,
      reference: payment.reference,
      providerOrderId: payment.providerOrderId,
      keyId: razorpayKeyId(),
      amountCents: payment.amountCents,
      currency: payment.currency,
      mode,
    });
  }

  const session = await createProviderOrder({
    reference: payment.reference,
    amountCents: payment.amountCents,
    currency: payment.currency,
  });
  if (!session.providerOrderId) {
    await recordIntegrationAudit(order.restaurantId, "PAYMENT_EXCEPTION", { actor: "system" }, {
      order_id: order.id,
      external_order_id: order.externalOrderId,
      payment_reference: payment.reference,
      failure_code: session.code,
      failure_message: "provider order allocation failed on retry",
    });
    return apiError(502, "Could not start the payment", session.code ?? undefined);
  }

  await bindProviderOrderId(payment.reference, session.providerOrderId);
  return Response.json({
    ok: true,
    status: payment.status,
    reference: payment.reference,
    providerOrderId: session.providerOrderId,
    keyId: razorpayKeyId(),
    amountCents: payment.amountCents,
    currency: payment.currency,
    mode: session.mode,
  });
}
