import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { enqueueOutboundEvent } from "@/lib/webhook-outbox";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/[reference]/retry-delivery
 *
 * PHASE 16 — Manually retry a failed POS delivery. Resets the order's
 * delivery status and re-enqueues the event into the outbox. Only works
 * when the current status is "failed".
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference } = await params;
  if (!reference || !reference.startsWith("MKT-")) {
    return Response.json({ error: "Invalid order reference" }, { status: 400 });
  }

  const [order] = await db
    .select({
      id: orders.id,
      posDeliveryStatus: orders.posDeliveryStatus,
    })
    .from(orders)
    .where(eq(orders.reference, reference))
    .limit(1);

  if (!order) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.posDeliveryStatus === "delivered") {
    return Response.json(
      { error: "Order was already delivered to POS" },
      { status: 409 },
    );
  }

  // Reset delivery state before re-enqueueing.
  await db
    .update(orders)
    .set({
      posDeliveryStatus: "pending",
      posDeliveryAttempts: 0,
      posLastDeliveryError: "",
    })
    .where(eq(orders.id, order.id));

  const queued = await enqueueOutboundEvent(order.id, "order.created");

  return Response.json({
    ok: true,
    queued,
    status: queued ? "queued" : "failed",
    message: queued
      ? "Order re-enqueued for POS delivery"
      : "Could not enqueue — restaurant POS may not be connected",
  });
}
