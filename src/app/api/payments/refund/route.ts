import { NextRequest } from "next/server";
import { db } from "@/db";
import { payments, orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { safeJson, errorJson } from "@/lib/api";
import { requireAdmin } from "@/lib/admin-auth";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/refund — admin only.
 *
 * Refunds a payment for an order. Only captured payments can be refunded; a
 * full refund by default, or a partial amount when `amountInr` is provided.
 *
 * Body: { reference, amountInr? }
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return errorJson("Unauthorized", 401);

  try {
    const body = await request.json();
    const reference = String(body.reference ?? "").trim().toUpperCase();
    if (!/^MKT-[A-Z0-9]+$/.test(reference)) {
      return errorJson("Invalid order reference", 400);
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.reference, reference))
      .limit(1);
    if (!order) return errorJson("Order not found", 404);

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(payments.id)
      .limit(1);
    if (!payment) return errorJson("No card payment on this order", 404);
    if (payment.status !== "captured") {
      return errorJson(`Payment cannot be refunded (status: ${payment.status})`, 409);
    }
    if (!payment.razorpayPaymentId) {
      return errorJson("Payment has no gateway payment id", 409);
    }

    const requested = body.amountInr === undefined ? undefined : Number(body.amountInr);
    if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
      return errorJson("Invalid refund amount", 400);
    }
    const paid = num(payment.amount);
    if (requested !== undefined && requested > paid) {
      return errorJson(`Refund amount cannot exceed ${paid.toFixed(2)}`, 400);
    }

    const { refundRazorpayPayment } = await import("@/lib/razorpay");
    const refund = await refundRazorpayPayment(payment.razorpayPaymentId, requested);

    if (!refund.ok) return errorJson(refund.error, 502);

    const full = requested === undefined || requested >= paid;
    await db
      .update(payments)
      .set({
        status: full ? "refunded" : "partial_refunded",
        refundId: refund.refundId,
        refundAmount: (refund.refundAmountPaise / 100).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    await db
      .update(orders)
      .set({ paymentStatus: full ? "refunded" : "paid" })
      .where(eq(orders.id, order.id));

    return safeJson({
      ok: true,
      refundId: refund.refundId,
      amountInr: refund.refundAmountPaise / 100,
      status: full ? "refunded" : "partial_refunded",
    });
  } catch (e) {
    console.error("POST /api/payments/refund", e);
    return errorJson("Failed to refund payment", 500);
  }
}