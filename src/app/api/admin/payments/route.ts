import { db } from "@/db";
import { payments, orders, restaurants } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { num } from "@/lib/format";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/payments — payment audit trail for the operator dashboard.
 * Joins each payment row with its order + restaurant. Refunds are executed
 * through POST /api/payments/refund (same page).
 */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: payments.id,
      orderId: orders.id,
      orderReference: orders.reference,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
      customerName: orders.customerName,
      amount: payments.amount,
      currency: payments.currency,
      status: payments.status,
      razorpayOrderId: payments.razorpayOrderId,
      razorpayPaymentId: payments.razorpayPaymentId,
      refundId: payments.refundId,
      refundAmount: payments.refundAmount,
      failureReason: payments.failureReason,
      paymentMethod: orders.paymentMethod,
      orderStatus: orders.status,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .orderBy(desc(payments.createdAt))
    .limit(200);

  const list = rows.map((p) => ({
    id: p.id,
    order: p.orderId
      ? {
          id: p.orderId,
          reference: p.orderReference,
          customerName: p.customerName,
          paymentMethod: p.paymentMethod,
          status: p.orderStatus,
        }
      : null,
    restaurant: { name: p.restaurantName, slug: p.restaurantSlug },
    amount: num(p.amount),
    currency: p.currency,
    status: p.status,
    razorpayOrderId: p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    refundId: p.refundId,
    refundAmount: num(p.refundAmount),
    failureReason: p.failureReason,
    createdAt: p.createdAt.toISOString(),
  }));

  return Response.json({
    payments: list,
    stats: {
      total: list.length,
      captured: list.filter((p) => p.status === "captured").length,
      refunded: list.filter(
        (p) => p.status === "refunded" || p.status === "partial_refunded",
      ).length,
      failed: list.filter((p) => p.status === "failed").length,
    },
  });
}