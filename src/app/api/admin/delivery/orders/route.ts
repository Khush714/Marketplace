import { db } from "@/db";
import {
  orders,
  deliveryAssignments,
  deliveryPartners,
  deliveryOrders,
} from "@/db/schema";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { deliveryStatusCanonical } from "@/lib/delivery-status";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/delivery/orders — live delivery jobs in the dispatch queue.
 *
 * The queue is driven by the DELIVERY track (`delivery_orders.delivery_status`),
 * not the kitchen status — the kitchen settles to `picked_up`/`delivered` while
 * the rider is still on the road, so kitchen-based filters would drop orders
 * mid-route. Orders with a still-live delivery status (plus legacy delivery
 * orders created before PHASE 45, which have no `delivery_orders` row yet)
 * appear here until their delivery reaches a terminal state.
 *
 * The assignment `token` is included so the dispatcher can hand the rider the
 * PWA link at /rider/:token (the token IS the rider's credential).
 */
export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const liveDelivery = [
    "pending_assignment",
    "pending", // legacy pre-PHASE-4 rows
    "assigned",
    "accepted",
    "at_restaurant",
    "picked_up",
    "out_for_delivery",
    "arriving",
  ];
  const liveKitchen = ["placed", "accepted", "preparing", "ready"];

  const rows = await db
    .select({
      reference: orders.reference,
      status: orders.status,
      deliveryStatus: deliveryOrders.deliveryStatus,
      total: orders.total,
      customerName: orders.customerName,
      customerAddress: orders.customerAddress,
      scheduledFor: orders.scheduledFor,
      createdAt: orders.createdAt,
      assignmentStatus: deliveryAssignments.status,
      assignmentToken: deliveryAssignments.token,
      partnerId: deliveryPartners.id,
      partnerName: deliveryPartners.name,
    })
    .from(orders)
    .leftJoin(
      deliveryOrders,
      eq(deliveryOrders.orderId, orders.id),
    )
    .leftJoin(
      deliveryAssignments,
      eq(deliveryAssignments.orderId, orders.id),
    )
    .leftJoin(
      deliveryPartners,
      eq(deliveryPartners.id, deliveryAssignments.partnerId),
    )
    .where(
      and(
        eq(orders.fulfillmentType, "delivery"),
        or(
          // Has a live delivery track (rider still on the road).
          inArray(deliveryOrders.deliveryStatus, liveDelivery),
          // Legacy delivery order: kitchen still live and not yet tracked.
          and(
            inArray(orders.status, liveKitchen),
            isNull(deliveryOrders.orderId),
          ),
        ),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(60);

  return Response.json({
    orders: rows.map((r) => ({
      reference: r.reference,
      status: r.status,
      deliveryStatus: r.deliveryStatus
        ? deliveryStatusCanonical(r.deliveryStatus)
        : null,
      total: num(r.total),
      customerName: r.customerName,
      customerAddress: r.customerAddress,
      scheduledFor: r.scheduledFor ? r.scheduledFor.toISOString() : null,
      placedAt: r.createdAt.toISOString(),
      assignment: r.assignmentStatus
        ? {
            status: r.assignmentStatus,
            partnerId: r.partnerId ?? null,
            partnerName: r.partnerName ?? null,
            token: r.assignmentToken ?? null,
          }
        : null,
    })),
  });
}