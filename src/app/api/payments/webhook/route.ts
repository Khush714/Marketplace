import { NextRequest } from "next/server";
import { db } from "@/db";
import { payments, orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyRazorpayWebhookSignature } from "@/lib/razorpay";
import { appendOrderEvent } from "@/lib/order-events";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * POST /api/payments/webhook
 *
 * Razorpay fires async events here (payment.captured, payment.failed,
 * refund.processed, …). Signature-verified via the X-Razorpay-Signature
 * header; only then is the payments row + orders.payment_status mutated.
 *
 * Set your webhook secret in RAZORPAY_WEBHOOK_SECRET and configure the URL
 * https://<your-domain>/api/payments/webhook in the Razorpay dashboard.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyRazorpayWebhookSignature(raw, signature ?? "")) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const eventName: string = event?.event ?? "";
  const paymentEntity = event?.payload?.payment?.entity ?? null;
  const refundEntity = event?.payload?.refund?.entity ?? null;

  try {
    if (eventName === "payment.captured" || eventName === "payment.authorized") {
      await onCaptured(paymentEntity);
    } else if (eventName === "payment.failed") {
      await onFailed(paymentEntity);
    } else if (
      eventName === "refund.processed" ||
      eventName === "refund.created"
    ) {
      await onRefunded(refundEntity, eventName);
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("[razorpay] webhook handler error", e);
    return new Response("Handler error", { status: 500 });
  }
}

async function onCaptured(entity: any) {
  if (!entity?.order_id || !entity?.id) return;

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, String(entity.order_id)))
    .limit(1);
  if (!payment) return;

  const paidPaise = Number(entity.amount ?? 0);
  const expectedPaise = Math.round(num(payment.amount) * 100);

  // Only ever auto-confirm when the amounts match. A mismatched capture is
  // flagged via the status field but does NOT flip the order to paid.
  if (paidPaise === expectedPaise) {
    await db
      .update(payments)
      .set({
        razorpayPaymentId: String(entity.id),
        status: "captured",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    if (payment.orderId) {
      // PHASE 10 — only flip + audit when the order isn't already paid (the
      // checkout verify route marks card orders paid at creation, so a later
      // webhook is a no-op replay rather than a duplicate event).
      const [cur] = await db
        .select({ paymentStatus: orders.paymentStatus })
        .from(orders)
        .where(eq(orders.id, payment.orderId))
        .limit(1);
      if (cur && cur.paymentStatus !== "paid") {
        await db
          .update(orders)
          .set({ paymentStatus: "paid" })
          .where(eq(orders.id, payment.orderId));
        await appendOrderEvent(db, {
          orderId: payment.orderId,
          type: "PAYMENT_CONFIRMED",
          actor: "payment",
          meta: {
            method: "card",
            razorpayPaymentId: String(entity.id),
            amount: paidPaise / 100,
          },
          note: "Razorpay webhook payment.captured",
        });
      }
    }
  } else {
    await db
      .update(payments)
      .set({
        razorpayPaymentId: String(entity.id),
        status: "captured",
        failureReason: `Webhook captured amount mismatch: paid ${paidPaise} paise, expected ${expectedPaise}`,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));
  }
}

async function onFailed(entity: any) {
  const orderId = entity?.order_id ? String(entity.order_id) : null;
  if (!orderId && entity?.id) {
    // Payment id only — locate via a prior payment row.
    const [byPay] = await db
      .select()
      .from(payments)
      .where(eq(payments.razorpayPaymentId, String(entity.id)))
      .limit(1);
    if (byPay) {
      await markFailed(byPay.id, byPay.orderId, entity);
    }
    return;
  }
  if (!orderId) return;
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, orderId))
    .limit(1);
  if (!payment) return;
  await markFailed(payment.id, payment.orderId, entity);
}

async function markFailed(paymentId: number, orderId: number | null, entity: any) {
  const updates: {
    razorpayPaymentId?: string;
    status: string;
    failureReason?: string;
    updatedAt: Date;
  } = {
    status: "failed",
    failureReason: `Payment failed: ${entity?.error_description ?? entity?.error_reason ?? "unknown reason"}`,
    updatedAt: new Date(),
  };
  if (entity?.id) updates.razorpayPaymentId = String(entity.id);

  await db.update(payments).set(updates).where(eq(payments.id, paymentId));

  if (orderId) {
    const [cur] = await db
      .select({ paymentStatus: orders.paymentStatus })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (cur && cur.paymentStatus !== "failed") {
      await db
        .update(orders)
        .set({ paymentStatus: "failed" })
        .where(eq(orders.id, orderId));
      // PHASE 10 — audit the failure next to the paid/milestone trail.
      await appendOrderEvent(db, {
        orderId,
        type: "PAYMENT_FAILED",
        actor: "payment",
        meta: { method: "card", razorpayPaymentId: entity?.id ?? null },
        note: updates.failureReason ?? "Razorpay webhook payment.failed",
      });
    }
  }
}

async function onRefunded(entity: any, eventName: string) {
  if (!entity?.payment_id || !entity?.id) return;

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayPaymentId, String(entity.payment_id)))
    .limit(1);
  if (!payment) return;

  const refundPaise = Number(entity.amount ?? 0);
  const paidPaise = Math.round(num(payment.amount) * 100);

  // A full refund vs a partial one.
  const full = refundPaise >= paidPaise;
  const status = full ? "refunded" : "partial_refunded";

  await db
    .update(payments)
    .set({
      status,
      refundId: String(entity.id),
      refundAmount: (refundPaise / 100).toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

  if (payment.orderId) {
    await db
      .update(orders)
      .set({ paymentStatus: full ? "refunded" : "paid" })
      .where(eq(orders.id, payment.orderId));

    // PHASE 10 — audit the refund alongside the confirmed payment.
    await appendOrderEvent(db, {
      orderId: payment.orderId,
      type: full ? "PAYMENT_REFUNDED" : "PAYMENT_PARTIAL_REFUNDED",
      actor: "payment",
      meta: {
        refundId: String(entity.id),
        razorpayPaymentId: String(entity.payment_id),
        amount: refundPaise / 100,
        status,
      },
      note: eventName === "refund.created" ? "Refund created" : "Refund processed",
    });
  }
}