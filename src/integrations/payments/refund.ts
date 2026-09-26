import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordIntegrationAudit } from "@/db/queries";
import {
  cancelPendingPayment,
  getActivePaymentByOrder,
  markRefundRequested,
  type PaymentRecordView,
} from "@/db/payments";
import { orders } from "@/db/schema";

/**
 * Refund orchestration (Phase 6) — runs when a CAPTURED order is cancelled.
 *
 * Money rules:
 *   - Never captured (PAYMENT_PENDING / UNPAID): nothing to return — the
 *     payment is simply closed PAYMENT_CANCELLED (the order never reached the
 *     POS with money from us).
 *   - Captured (PAID / PARTIAL / PARTIALLY_REFUNDED): mark REFUND_PENDING,
 *     then ask the provider to refund; the provider webhook (refund.completed)
 *     is the ONLY confirmation — the Marketplace never invents a returned sum.
 *
 * Idempotent: after the first REFUND_PENDING, repeated calls are no-ops, and
 * the provider refund id / event ledger make replays safe.
 */

export async function handleCancelledOrderPayment(
  restaurantId: number,
  externalOrderId: string,
  reason: string,
): Promise<void> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.restaurantId, restaurantId), eq(orders.externalOrderId, externalOrderId)))
    .limit(1);
  if (!order) return;

  const live = await getActivePaymentByOrder(order.id);
  if (live && (live.status === "PAYMENT_PENDING" || live.status === "UNPAID")) {
    await cancelPendingPayment(order);
    return;
  }

  const refundable = await markRefundRequested(order.id, reason);
  if (!refundable || refundable.status !== "REFUND_PENDING") return;
  await initiateProviderRefund(refundable, reason);
}

/**
 * Ask the provider to issue the refund. Best-effort by design: this is the
 * initiation signal, not the confirmation — a failure simply leaves the
 * payment REFUND_PENDING where the reconciliation job surfaces it. Never logs
 * the API secret.
 */
export async function initiateProviderRefund(
  payment: PaymentRecordView,
  reason: string,
): Promise<boolean> {
  if (!payment.providerPaymentId) {
    await recordIntegrationAudit(payment.restaurantId, "REFUND_FAILED", { actor: "system" }, {
      order_id: payment.orderId,
      external_order_id: payment.externalOrderId,
      payment_reference: payment.reference,
      failure_code: "PROVIDER_PAYMENT_ID_MISSING",
      failure_message: "refund requested for a payment with no provider capture",
    });
    return false;
  }

  const remaining = payment.amountCents - payment.refundedAmountCents;
  if (remaining <= 0) return true;

  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (!keyId || !keySecret) {
    await recordIntegrationAudit(payment.restaurantId, "REFUND_FAILED", { actor: "system" }, {
      order_id: payment.orderId,
      external_order_id: payment.externalOrderId,
      payment_reference: payment.reference,
      failure_code: "PROVIDER_NOT_CONFIGURED",
      failure_message: "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not configured",
    });
    return false;
  }

  const basic = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(payment.providerPaymentId)}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          amount: remaining,
          notes: { marketplace_reference: payment.reference, reason },
        }),
        signal: controller.signal,
      },
    );
    if (res.ok) {
      await recordIntegrationAudit(payment.restaurantId, "REFUND_REQUESTED", { actor: "system" }, {
        order_id: payment.orderId,
        external_order_id: payment.externalOrderId,
        payment_reference: payment.reference,
        provider_payment_id: payment.providerPaymentId,
        refund_request_amount_cents: remaining,
        reason,
        provider_http_status: res.status,
      });
      return true;
    }
    await recordIntegrationAudit(payment.restaurantId, "REFUND_FAILED", { actor: "system" }, {
      order_id: payment.orderId,
      external_order_id: payment.externalOrderId,
      payment_reference: payment.reference,
      failure_code: `PROVIDER_REFUND_HTTP_${res.status}`,
      reason,
    });
    return false;
  } catch {
    await recordIntegrationAudit(payment.restaurantId, "REFUND_FAILED", { actor: "system" }, {
      order_id: payment.orderId,
      external_order_id: payment.externalOrderId,
      payment_reference: payment.reference,
      failure_code: "PROVIDER_UNREACHABLE",
      reason,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}