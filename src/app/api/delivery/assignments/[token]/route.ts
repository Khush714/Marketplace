import { db } from "@/db";
import {
  deliveryAssignments,
  orders,
  deliveryPartners,
  restaurants,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  advanceDeliveryAssignment,
  DELIVERY_LABELS,
  nextDeliveryStatuses,
  type DeliveryStatus,
} from "@/lib/delivery";

export const dynamic = "force-dynamic";

/**
 * GET /api/delivery/assignments/:token — rider view of their job.
 * The token is the rider's credential (same pattern as the public order
 * reference), so no session is required. Echoes pickup + dropoff addresses
 * and the allowed next states.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = (await params).token.trim();
  const [a] = await db
    .select({
      token: deliveryAssignments.token,
      status: deliveryAssignments.status,
      orderReference: orders.reference,
      restaurantName: restaurants.name,
      restaurantAddress: restaurants.address,
      restaurantLat: restaurants.lat,
      restaurantLng: restaurants.lng,
      customerName: orders.customerName,
      customerAddress: orders.customerAddress,
      dropoffLat: orders.dropoffLat,
      dropoffLng: orders.dropoffLng,
      total: orders.total,
      scheduledFor: orders.scheduledFor,
      partnerName: deliveryPartners.name,
      vehicleType: deliveryPartners.vehicleType,
    })
    .from(deliveryAssignments)
    .innerJoin(orders, eq(orders.id, deliveryAssignments.orderId))
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .leftJoin(
      deliveryPartners,
      eq(deliveryPartners.id, deliveryAssignments.partnerId),
    )
    .where(eq(deliveryAssignments.token, token))
    .limit(1);

  if (!a) return Response.json({ error: "Assignment not found" }, { status: 404 });

  const status = a.status as DeliveryStatus;
  return Response.json({
    assignment: {
      token: a.token,
      status,
      label: DELIVERY_LABELS[status] ?? status,
      next: nextDeliveryStatuses(status),
      orderReference: a.orderReference,
      restaurant: {
        name: a.restaurantName,
        address: a.restaurantAddress,
        lat:
          a.restaurantLat != null && a.restaurantLng != null
            ? Number(a.restaurantLat)
            : null,
        lng:
          a.restaurantLat != null && a.restaurantLng != null
            ? Number(a.restaurantLng)
            : null,
      },
      customer: { name: a.customerName, address: a.customerAddress },
      dropoff:
        a.dropoffLat != null && a.dropoffLng != null
          ? { lat: Number(a.dropoffLat), lng: Number(a.dropoffLng) }
          : null,
      total: Number(a.total),
      scheduledFor: a.scheduledFor ? a.scheduledFor.toISOString() : null,
      rider: a.partnerName ? { name: a.partnerName, vehicleType: a.vehicleType } : null,
    },
  });
}

/**
 * PATCH /api/delivery/assignments/:token — advance the delivery.
 *   { "toStatus": "accepted" | "at_restaurant" | "picked_up" |
 *                 "out_for_delivery" | "arriving" | "delivered", "note": "" }
 *
 * Transitions must follow the canonical forward mainline in
 * src/lib/delivery-status.ts (the server enforces it via
 * canDeliveryTransition).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const token = (await params).token.trim();
  const body = (await request.json().catch(() => null)) as {
    toStatus?: unknown;
    note?: unknown;
  } | null;
  if (!body) return Response.json({ error: "Bad request" }, { status: 400 });

  const res = await advanceDeliveryAssignment(token, String(body.toStatus ?? ""), {
    note: String(body.note ?? ""),
  });
  if (!res.ok || !res.assignment) {
    return Response.json(
      { error: res.error ?? "Could not advance delivery" },
      { status: res.status ?? 400 },
    );
  }

  return Response.json({
    assignment: {
      id: res.assignment.id,
      token: res.assignment.token,
      status: res.assignment.status,
    },
  });
}