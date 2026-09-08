import { NextRequest } from "next/server";
import { db } from "@/db";
import { payments, orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { safeJson, errorJson } from "@/lib/api";
import { placeOrder } from "@/lib/marketplace";
import { verifyRazorpaySignature, reconcileRazorpayPayment } from "@/lib/razorpay";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/verify
 *
 * Step 2 of the Razorpay checkout flow. Called by the client AFTER the
 * Razorpay modal returns a successful payment. Steps:
 *
 *   1. Load the payment intent row (created by /create-order) by reference.
 *   2. Verify the HMAC signature from the checkout response.
 *   3. Reconcile with Razorpay: payment must be captured AND the paid amount
 *      must equal the intent amount.
 *   4. Create the marketplace order with the same reference and total
 *      (single pricing authority), paymentStatus "paid".
 *   5. Patch the intent row with orderId + payment ids + status "captured".
 *
 * This is safe to call twice — the second call loads the already-created order
 * and returns it.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const reference = String(body.reference ?? "").trim().toUpperCase();
    const razorpayPaymentId = String(body.razorpayPaymentId ?? "").trim();
    const razorpaySignature = String(body.razorpaySignature ?? "").trim();

    if (!reference || !razorpayPaymentId || !razorpaySignature) {
      return errorJson("Missing payment verification data", 400);
    }
    if (!/^MKT-[A-Z0-9]+$/.test(reference)) {
      return errorJson("Invalid order reference", 400);
    }

    // A previously-verified reference just replays the order.
    const [existingOrder] = await db
      .select({ id: orders.id, reference: orders.reference, total: orders.total })
      .from(orders)
      .where(eq(orders.reference, reference))
      .limit(1);
    if (existingOrder) {
      return safeJson({
        ok: true,
        existing: true,
        reference: existingOrder.reference,
        total: num(existingOrder.total),
      });
    }

    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.reference, reference))
      .limit(1);

    if (!payment) {
      return errorJson("No payment intent found for this order", 404);
    }

    const sig = verifyRazorpaySignature({
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      expectedAmountInr: num(payment.amount),
    });
    if (!sig.ok) return errorJson(sig.error, 400);

    const reconcile = await reconcileRazorpayPayment(
      razorpayPaymentId,
      num(payment.amount),
    );
    if (!reconcile.ok) return errorJson(reconcile.error, 402);

    // Parse the stored cart + customer intent so order creation reuses the
    // exact inputs that were charged.
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(payment.metadata || "{}");
    } catch {
      meta = {};
    }

    const placed = await placeOrder({
      restaurant: String(meta.restaurantId ?? ""),
      customerId: meta.customerId ? Number(meta.customerId) : undefined,
      customerName: String(meta.customerName ?? ""),
      customerPhone: String(meta.customerPhone ?? ""),
      customerAddress:
        typeof meta.customerAddress === "string" ? meta.customerAddress : "",
      fulfillmentType:
        meta.fulfillmentType === "pickup" ? "pickup" : "delivery",
      paymentMethod: "card",
      notes: typeof meta.notes === "string" ? meta.notes : "",
      discountCode:
        typeof meta.discountCode === "string" && meta.discountCode
          ? meta.discountCode
          : undefined,
      items: Array.isArray(meta.cart) ? meta.cart : [],
      reference,
    });

    if (!placed.ok) return errorJson(placed.error, placed.status);

    await db
      .update(payments)
      .set({
        orderId: placed.id,
        razorpayPaymentId,
        razorpaySignature,
        status: "captured",
        updatedAt: new Date(),
      })
      .where(eq(payments.reference, reference));

    return safeJson({
      ok: true,
      reference: placed.reference,
      total: placed.total,
      fulfillment: placed.fulfillment,
    });
  } catch (e) {
    console.error("POST /api/payments/verify", e);
    return errorJson("Failed to verify payment", 500);
  }
}