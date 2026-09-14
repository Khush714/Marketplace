/**
 * PHASE 29 — delivery dispatch layer (riders / GPS / assignment tokens).
 * PHASE 45 — decoupled delivery engine.
 *
 * The delivery TRACK is authoritative on `delivery_orders.delivery_status`.
 * The canonical lifecycle lives in `src/lib/delivery-status.ts` and is
 * deliberately decoupled from the kitchen lifecycle (`orders.status`). This
 * module owns:
 *
 *   • creating the `delivery_orders` row when a delivery order is placed
 *   • assigning / re-assigning a delivery partner (+ optional restaurant rider)
 *   • advancing the delivery track (rider PATCH / admin single-step)
 *   • unassigning a partner (delivery returns to `pending`)
 *   • ingesting rider GPS fixes (live columns + `rider_locations` history)
 *   • building the public delivery envelope the customer tracker consumes
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import {
  deliveryAssignments,
  deliveryEvents,
  deliveryOrders,
  deliveryPartners,
  deliveryRiders,
  notifications,
  orders,
  restaurants,
  riderLocations,
} from "@/db/schema";
import {
  appendOrderEvent,
  type OrderEventConnection,
  type OrderEventType,
} from "@/lib/order-events";
import { transitionOrder } from "@/lib/order-actions";
import { statusLabel } from "@/lib/order-lifecycle";
import {
  publishOrderEvent,
  publishRiderLocation,
} from "@/lib/realtime";
import {
  canDeliveryTransition,
  DELIVERY_LABELS,
  DELIVERY_MAINLINE,
  deliveryStatusCanonical,
  deliveryStep,
  isDeliveryTerminal,
  nextDeliveryStatuses,
  type DeliveryStatus,
} from "@/lib/delivery-status";

/* ------------------------------------------------------------------ *
 * Re-export the canonical contract so existing consumers keep one      *
 * import surface (marketplace.ts, rider routes, admin).               *
 * ------------------------------------------------------------------ */
export {
  DELIVERY_LABELS,
  DELIVERY_MAINLINE,
  deliveryStatusCanonical,
  deliveryStep,
  isDeliveryTerminal,
  canDeliveryTransition,
  nextDeliveryStatuses,
};
export type { DeliveryStatus };

/** Legacy alias kept for the admin single-step helpers. */
export const DELIVERY_FLOW = DELIVERY_MAINLINE;

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */
export const RIDER_SPEED_KMH = 28;
export const riderTravelMinutes = (distanceKm: number) =>
  distanceKm <= 0 ? 0 : Math.round((distanceKm / RIDER_SPEED_KMH) * 60);

export const riderDistanceKm = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) => {
  // https://en.wikipedia.org/wiki/Haversine_formula
  const R = 6371;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

/** PHASE 27 — references only on public surfaces; ids still work internally. */
async function getOrderByRef(reference: string) {
  const [o] = await db
    .select()
    .from(orders)
    .where(eq(orders.reference, reference.toUpperCase()))
    .limit(1);
  return o ?? null;
}

/* ------------------------------------------------------------------ *
 * Delivery events (per-delivery audit log in `delivery_events`)       *
 * ------------------------------------------------------------------ */
const DELIVERY_EVENT_TYPES: Record<string, string> = {
  assigned: "DELIVERY_ASSIGNED",
  accepted: "RIDER_ACCEPTED",
  at_restaurant: "RIDER_AT_RESTAURANT",
  picked_up: "RIDER_PICKED_UP",
  out_for_delivery: "RIDER_OUT_FOR_DELIVERY",
  arriving: "RIDER_ARRIVING",
  delivered: "DELIVERY_COMPLETED",
  failed: "DELIVERY_FAILED",
  cancelled: "DELIVERY_CANCELLED",
  created: "DELIVERY_CREATED",
  unassigned: "DELIVERY_UNASSIGNED",
};

/** The order-audit event type for a given canonical delivery status. */
const DELIVERY_ORDER_EVENTS: Partial<Record<string, OrderEventType>> = {
  accepted: "RIDER_ACCEPTED",
  at_restaurant: "RIDER_AT_RESTAURANT",
  picked_up: "RIDER_PICKED_UP",
  out_for_delivery: "RIDER_OUT_FOR_DELIVERY",
  arriving: "RIDER_ARRIVING",
  cancelled: "RIDER_CANCELLED",
};

/** Shared `db` or any caller transaction (same pattern as OrderEventConnection). */
export type DeliveryTx = OrderEventConnection;

/** Append an event to a delivery's audit trail (atomic with its action). */
export async function appendDeliveryEvent(
  conn: DeliveryTx,
  input: {
    deliveryOrderId: number;
    eventType: string;
    actor?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await conn.insert(deliveryEvents).values({
    deliveryOrderId: input.deliveryOrderId,
    eventType: input.eventType,
    actor: input.actor ?? "system",
    metadata: JSON.stringify(input.metadata ?? {}),
  });
}

/** Idempotent by unique `order_id`. Creates + records DELIVERY_CREATED. */
export async function createDeliveryOrderForOrderTx(
  conn: DeliveryTx,
  input: {
    orderId: number;
    restaurantId: number;
    deliveryFee: string | null;
    dropoffLat: string | null;
    dropoffLng: string | null;
    scheduledFor: Date | null;
    pickup: { lat: string | null; lng: string | null };
    mode?: string;
  },
) {
  const [existing] = await conn
    .select()
    .from(deliveryOrders)
    .where(eq(deliveryOrders.orderId, input.orderId))
    .limit(1);
  if (existing) return existing;

  const [row] = await conn
    .insert(deliveryOrders)
    .values({
      orderId: input.orderId,
      restaurantId: input.restaurantId,
      deliveryStatus: "pending",
      deliveryMode: input.mode ?? "platform",
      deliveryFee: input.deliveryFee ?? "0",
      pickupLat: input.pickup.lat,
      pickupLng: input.pickup.lng,
      dropoffLat: input.dropoffLat,
      dropoffLng: input.dropoffLng,
      estimatedDeliveryAt: input.scheduledFor ?? null,
    })
    .returning();

  await appendDeliveryEvent(conn, {
    deliveryOrderId: row.id,
    eventType: "DELIVERY_CREATED",
    actor: "system",
    metadata: { mode: input.mode ?? "platform" },
  });
  return row;
}

/** Sync the delivery track status (authoritative) + updatedAt. */
async function setDeliveryTrackStatus(
  conn: DeliveryTx,
  deliveryOrderId: number,
  status: DeliveryStatus,
): Promise<void> {
  await conn
    .update(deliveryOrders)
    .set({ deliveryStatus: status, updatedAt: new Date() })
    .where(eq(deliveryOrders.id, deliveryOrderId));
}

/* ------------------------------------------------------------------ *
 * Public delivery envelope                                            *
 * ------------------------------------------------------------------ */
export type LatLng = { lat: number; lng: number };

export type RiderFix = {
  lat: number;
  lng: number;
  at: string;
  heading?: number | null;
};

export type PublicDelivery = {
  status: string;
  rawStatus: string;
  label: string;
  step: number;
  terminal: boolean;
  mode: string;
  provider: string;
  providerDeliveryId: string;
  estimatedPickupAt: string | null;
  estimatedDeliveryAt: string | null;
  partner: { id: number; name: string; vehicleType: string } | null;
  rider: RiderFix | null;
  dropoff: LatLng | null;
};

function parseLatLng(
  lat: string | null | undefined,
  lng: string | null | undefined,
): LatLng | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

/**
 * The full delivery envelope for the customer tracker. Returns a PENDING
 * envelope as soon as a `delivery_orders` row exists — the tracker shows
 * "Waiting for a driver" even before any assignment. Legacy orders (placed
 * before PHASE 45, no `delivery_orders` row) fall back to their assignment.
 * Returns null only when there is genuinely no delivery involvement.
 */
export async function getDeliveryForOrder(
  orderId: number,
): Promise<PublicDelivery | null> {
  const [track] = await db
    .select({
      id: deliveryOrders.id,
      deliveryStatus: deliveryOrders.deliveryStatus,
      deliveryMode: deliveryOrders.deliveryMode,
      provider: deliveryOrders.provider,
      providerDeliveryId: deliveryOrders.providerDeliveryId,
      estimatedPickupAt: deliveryOrders.estimatedPickupAt,
      estimatedDeliveryAt: deliveryOrders.estimatedDeliveryAt,
      dropoffLat: deliveryOrders.dropoffLat,
      dropoffLng: deliveryOrders.dropoffLng,
    })
    .from(deliveryOrders)
    .where(eq(deliveryOrders.orderId, orderId))
    .limit(1);

  const [a] = await db
    .select({
      status: deliveryAssignments.status,
      deliveryOrderId: deliveryAssignments.deliveryOrderId,
      partnerId: deliveryAssignments.partnerId,
      partnerName: deliveryPartners.name,
      vehicleType: deliveryPartners.vehicleType,
      riderLat: deliveryAssignments.riderLat,
      riderLng: deliveryAssignments.riderLng,
      riderHeading: deliveryAssignments.riderHeading,
      riderAt: deliveryAssignments.locationUpdatedAt,
      dropoffLat: orders.dropoffLat,
      dropoffLng: orders.dropoffLng,
    })
    .from(deliveryAssignments)
    .innerJoin(orders, eq(orders.id, deliveryAssignments.orderId))
    .leftJoin(
      deliveryPartners,
      eq(deliveryPartners.id, deliveryAssignments.partnerId),
    )
    .where(eq(deliveryAssignments.orderId, orderId))
    .limit(1);

  if (!track && !a) return null;

  const rawStatus = track?.deliveryStatus ?? a!.status;
  const status = deliveryStatusCanonical(rawStatus);

  return {
    status,
    rawStatus,
    label: DELIVERY_LABELS[status],
    step:
      status === "delivered" ? DELIVERY_MAINLINE.length : deliveryStep(status),
    terminal: isDeliveryTerminal(status),
    mode: track?.deliveryMode ?? "platform",
    provider: track?.provider ?? "",
    providerDeliveryId: track?.providerDeliveryId ?? "",
    estimatedPickupAt: track?.estimatedPickupAt?.toISOString() ?? null,
    estimatedDeliveryAt: track?.estimatedDeliveryAt?.toISOString() ?? null,
    partner:
      a && a.partnerId && a.partnerName
        ? {
            id: a.partnerId,
            name: a.partnerName,
            vehicleType: a.vehicleType ?? "bike",
          }
        : null,
    dropoff: parseLatLng(
      track?.dropoffLat ?? a?.dropoffLat,
      track?.dropoffLng ?? a?.dropoffLng,
    ),
    rider:
      a && a.riderLat != null && a.riderLng != null
        ? {
            lat: Number(a.riderLat),
            lng: Number(a.riderLng),
            heading: a.riderHeading == null ? null : Number(a.riderHeading),
            at: (a.riderAt ?? new Date()).toISOString(),
          }
        : null,
  };
}

/** Rider live position for order id (customer map + admin). */
export async function getRiderLocationForOrder(
  orderId: number,
): Promise<RiderFix | null> {
  if (!orderId) return null;
  const [a] = await db
    .select({
      riderLat: deliveryAssignments.riderLat,
      riderLng: deliveryAssignments.riderLng,
      riderHeading: deliveryAssignments.riderHeading,
      locationUpdatedAt: deliveryAssignments.locationUpdatedAt,
    })
    .from(deliveryAssignments)
    .where(eq(deliveryAssignments.orderId, orderId))
    .limit(1);
  if (!a || a.riderLat == null || a.riderLng == null) return null;
  return {
    lat: Number(a.riderLat),
    lng: Number(a.riderLng),
    heading: a.riderHeading == null ? null : Number(a.riderHeading),
    at: (a.locationUpdatedAt ?? new Date()).toISOString(),
  };
}

/** Rider position resolved from a store-style order reference. */
export async function getRiderLocationForReference(
  reference: string,
): Promise<RiderFix | null> {
  if (!reference) return null;
  const [o] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.reference, reference))
    .limit(1);
  if (!o) return null;
  return getRiderLocationForOrder(o.id);
}

/** Dropoff coords anchored for the customer map. */
export async function getDeliveryDropoff(
  orderId: number,
): Promise<LatLng | null> {
  const [o] = await db
    .select({ dropoffLat: orders.dropoffLat, dropoffLng: orders.dropoffLng })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!o) return null;
  return parseLatLng(o.dropoffLat, o.dropoffLng);
}

/* ------------------------------------------------------------------ *
 * Rider GPS reporting                                                 *
 * ------------------------------------------------------------------ */
export type ReportRiderLocationResult = {
  ok: boolean;
  saved: boolean;
  skipped?: boolean;
  rider?: RiderFix | null;
  reason?: string;
  error?: string;
  status?: number;
};

const MIN_LOCATION_INTERVAL_MS = 4000;

export async function reportRiderLocation(
  token: string,
  input: { lat: number; lng: number; heading?: number | null },
): Promise<ReportRiderLocationResult> {
  if (!token) {
    return { ok: false, saved: false, error: "missing token", status: 400 };
  }
  const { lat, lng } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      ok: false,
      saved: false,
      error: "invalid coords",
      status: 400,
    };
  }

  const [a] = await db
    .select()
    .from(deliveryAssignments)
    .where(eq(deliveryAssignments.token, token))
    .limit(1);
  if (!a) {
    return { ok: false, saved: false, error: "no assignment", status: 404 };
  }

  const [order] = await db
    .select({ reference: orders.reference, id: orders.id })
    .from(orders)
    .where(eq(orders.id, a.orderId))
    .limit(1);
  if (!order) {
    return { ok: false, saved: false, error: "no order", status: 404 };
  }

  const lastAt = a.locationUpdatedAt
    ? new Date(a.locationUpdatedAt).getTime()
    : 0;
  if (Date.now() - lastAt < MIN_LOCATION_INTERVAL_MS) {
    return { ok: true, saved: false, skipped: true, reason: "rate limited" };
  }

  const headingOk = Number.isFinite(input.heading);
  const now = new Date();
  const fix = {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    heading: headingOk && input.heading != null ? input.heading : null,
    at: now.toISOString(),
  };

  // Live position on the assignment (fast read for map + staleness).
  await db
    .update(deliveryAssignments)
    .set({
      riderLat: String(fix.lat),
      riderLng: String(fix.lng),
      riderHeading:
        fix.heading == null ? null : String(Number(fix.heading.toFixed(2))),
      locationUpdatedAt: now,
    })
    .where(eq(deliveryAssignments.id, a.id));

  // PHASE 45 — append-only motion trail on `rider_locations`.
  if (a.deliveryOrderId != null) {
    await db.insert(riderLocations).values({
      deliveryOrderId: a.deliveryOrderId,
      riderId: a.riderId ?? null,
      partnerId: a.partnerId ?? null,
      latitude: String(fix.lat),
      longitude: String(fix.lng),
      heading: fix.heading == null ? null : String(Number(fix.heading.toFixed(2))),
      speed: null,
      recordedAt: now,
    });
  }

  await publishRiderLocation(order.reference, fix);

  return {
    ok: true,
    saved: true,
    rider: { lat: fix.lat, lng: fix.lng, heading: fix.heading, at: fix.at },
  };
}

/* ------------------------------------------------------------------ *
 * Dispatch — assign / advance / unassign                              *
 * ------------------------------------------------------------------ */
export type DeliveryResult = {
  ok: boolean;
  assignment?: {
    id: number;
    token: string;
    status: string;
    next: DeliveryStatus[];
  };
  delivery?: { status: string; terminal: boolean };
  error?: string;
  status?: number;
};

async function pushDeliveryNotification(
  order: { customerId: number | null; customerPhone: string | null },
  kind: string,
  message: string,
) {
  await db.insert(notifications).values({
    customerId: order.customerId,
    phone: order.customerPhone ?? "",
    orderId: (order as { id?: number }).id ?? null,
    kind,
    message,
    channel: "push",
  });
}

export async function assignDeliveryPartner(
  orderRef: string,
  partnerId: number,
  opts: { note?: string; riderId?: number | null } = {},
): Promise<DeliveryResult> {
  const order = await getOrderByRef(orderRef);
  if (!order) return { ok: false, error: "Order not found", status: 404 };
  if (order.status === "delivered" || order.status === "cancelled") {
    return { ok: false, error: "Order already terminal", status: 409 };
  }
  const [partner] = await db
    .select()
    .from(deliveryPartners)
    .where(eq(deliveryPartners.id, partnerId))
    .limit(1);
  if (!partner) return { ok: false, error: "Partner not found", status: 404 };
  if (partner.status === "offline") {
    return { ok: false, error: "Partner offline", status: 409 };
  }

  const [restaurant] = await db
    .select({ lat: restaurants.lat, lng: restaurants.lng })
    .from(restaurants)
    .where(eq(restaurants.id, order.restaurantId))
    .limit(1);

  const [riderRow] =
    opts.riderId != null
      ? await db
          .select()
          .from(deliveryRiders)
          .where(eq(deliveryRiders.id, opts.riderId))
          .limit(1)
      : [null];
  if (opts.riderId != null && !riderRow) {
    return { ok: false, error: "Rider not found", status: 404 };
  }

  const token = `${randomBytes(6).toString("hex")}.${Date.now().toString(36)}`;

  const done = await db.transaction(async (tx) => {
    // One live assignment per order: any previous assignment is superseded.
    await tx
      .delete(deliveryAssignments)
      .where(eq(deliveryAssignments.orderId, order.id));

    const track = await createDeliveryOrderForOrderTx(tx, {
      orderId: order.id,
      restaurantId: order.restaurantId,
      deliveryFee: order.deliveryFee ?? "0",
      dropoffLat: order.dropoffLat,
      dropoffLng: order.dropoffLng,
      scheduledFor: order.scheduledFor ?? null,
      pickup: { lat: restaurant?.lat ?? null, lng: restaurant?.lng ?? null },
      mode: "platform",
    });

    const [assignment] = await tx
      .insert(deliveryAssignments)
      .values({
        orderId: order.id,
        deliveryOrderId: track.id,
        partnerId,
        provider: riderRow ? "restaurant_rider" : "platform",
        riderId: riderRow?.id ?? null,
        status: "assigned",
        token,
        note: opts.note ?? "",
      })
      .returning({
        id: deliveryAssignments.id,
        token: deliveryAssignments.token,
        status: deliveryAssignments.status,
      });

    await tx
      .update(deliveryPartners)
      .set({ status: "busy" })
      .where(eq(deliveryPartners.id, partnerId));
    if (riderRow) {
      await tx
        .update(deliveryRiders)
        .set({ status: "busy" })
        .where(eq(deliveryRiders.id, riderRow.id));
    }

    await setDeliveryTrackStatus(tx, track.id, "assigned");
    await appendDeliveryEvent(tx, {
      deliveryOrderId: track.id,
      eventType: "DELIVERY_ASSIGNED",
      actor: "pos",
      metadata: {
        partnerId,
        partnerName: partner.name,
        riderId: riderRow?.id ?? null,
      },
    });
    await appendOrderEvent(tx, {
      orderId: order.id,
      type: "DELIVERY_ASSIGNED",
      actor: "pos",
      meta: { partnerId, partnerName: partner.name },
      note: opts.note ?? "",
    });

    await tx.insert(notifications).values({
      customerId: order.customerId,
      phone: order.customerPhone ?? "",
      orderId: order.id,
      kind: "delivery_assigned",
      message: `${partner.name} is on the way to pick up your order ${order.reference}.`,
      channel: "push",
    });

    return assignment;
  });

  await publishOrderEvent(order.reference, "delivery_assigned", "pos");

  const track = await getDeliveryForOrder(order.id);
  return {
    ok: true,
    assignment: {
      id: done.id,
      token: done.token,
      status: done.status,
      next: nextDeliveryStatuses("assigned"),
    },
    delivery: track ? { status: track.status, terminal: track.terminal } : undefined,
  };
}

export async function advanceDeliveryAssignment(
  token: string,
  toStatusRaw: string,
  opts: { note?: string } = {},
): Promise<DeliveryResult> {
  const [a] = await db
    .select()
    .from(deliveryAssignments)
    .where(eq(deliveryAssignments.token, token))
    .limit(1);
  if (!a) return { ok: false, error: "Assignment not found", status: 404 };

  const order = await getOrderByRefByToken(a);
  if (!order) return { ok: false, error: "Order not found", status: 404 };

  const toStatus = deliveryStatusCanonical(toStatusRaw);
  if (!canDeliveryTransition(a.status, toStatusRaw)) {
    return {
      ok: false,
      error: `Cannot advance delivery from "${a.status}" to "${toStatusRaw}"`,
      status: 409,
    };
  }

  if (
    toStatus === "delivered" &&
    order.scheduledFor != null &&
    order.scheduledFor.getTime() > new Date().getTime() + 5 * 60 * 1000
  ) {
    return { ok: false, error: "Cannot deliver ahead of schedule", status: 409 };
  }

  const now = new Date();

  // PHASE 45 — the delivery track owns the assignment status: canonical key.
  await db.transaction(async (tx) => {
    await tx
      .update(deliveryAssignments)
      .set({ status: toStatus })
      .where(eq(deliveryAssignments.id, a.id));

    if (a.deliveryOrderId != null) {
      await setDeliveryTrackStatus(tx, a.deliveryOrderId, toStatus);
      await appendDeliveryEvent(tx, {
        deliveryOrderId: a.deliveryOrderId,
        eventType: DELIVERY_EVENT_TYPES[toStatus] ?? "DELIVERY_PROGRESS",
        actor: "rider",
        metadata: { from: a.status, to: toStatus, note: opts.note ?? "" },
      });
    }

    const orderEventType = DELIVERY_ORDER_EVENTS[toStatus];
    if (orderEventType) {
      await appendOrderEvent(tx, {
        orderId: a.orderId,
        type: orderEventType,
        actor: "rider",
      });
    }

    if (toStatus === "accepted") {
      await tx
        .update(deliveryAssignments)
        .set({ acceptedAt: now })
        .where(eq(deliveryAssignments.id, a.id));
    } else if (toStatus === "picked_up") {
      await tx
        .update(deliveryAssignments)
        .set({ pickedUpAt: now })
        .where(eq(deliveryAssignments.id, a.id));

      await tx.insert(notifications).values({
        customerId: order.customerId,
        phone: order.customerPhone ?? "",
        orderId: order.id,
        kind: "delivery_picked_up",
        message: `Your order ${order.reference} has been picked up.`,
        channel: "push",
      });
    } else if (toStatus === "out_for_delivery") {
      await tx.insert(notifications).values({
        customerId: order.customerId,
        phone: order.customerPhone ?? "",
        orderId: order.id,
        kind: "delivery_out_for_delivery",
        message: `Your order ${order.reference} is out for delivery.`,
        channel: "push",
      });
    } else if (toStatus === "arriving") {
      await tx.insert(notifications).values({
        customerId: order.customerId,
        phone: order.customerPhone ?? "",
        orderId: order.id,
        kind: "delivery_arriving",
        message: `Your order ${order.reference} is arriving soon.`,
        channel: "push",
      });
    }

    if (toStatus === "delivered" && a.partnerId != null) {
      await tx
        .update(deliveryPartners)
        .set({
          status: "available",
          totalDeliveries: sql`${deliveryPartners.totalDeliveries} + 1`,
        })
        .where(eq(deliveryPartners.id, a.partnerId));
      if (a.riderId != null) {
        await tx
          .update(deliveryRiders)
          .set({ status: "available" })
          .where(eq(deliveryRiders.id, a.riderId));
      }
    } else if (isDeliveryTerminal(toStatus) && a.partnerId != null) {
      await tx
        .update(deliveryPartners)
        .set({ status: "available" })
        .where(eq(deliveryPartners.id, a.partnerId));
      if (a.riderId != null) {
        await tx
          .update(deliveryRiders)
          .set({ status: "available" })
          .where(eq(deliveryRiders.id, a.riderId));
      }
    }
  });

  // PHASE 45 — settle the KITCHEN lifecycle only at picked_up / delivered.
  // This happens after the delivery-track commit: `transitionOrder` owns its
  // own transaction + outbox/realtime flush, so it runs once state is final.
  if (toStatus === "picked_up" || toStatus === "delivered") {
    const settled = await transitionOrder(order.reference, toStatus, {
      actor: "system",
    });
    if (!settled.ok) {
      console.error("delivery advance: kitchen settle failed", settled.error);
    }
  }

  await publishOrderEvent(
    order.reference,
    `delivery_${toStatus}`,
    "rider",
  );

  const track = await getDeliveryForOrder(order.id);
  return {
    ok: true,
    assignment: {
      id: a.id,
      token,
      status: toStatus,
      next: nextDeliveryStatuses(toStatus),
    },
    delivery: track ? { status: track.status, terminal: track.terminal } : undefined,
  };
}

async function getOrderByRefByToken(a: { orderId: number }) {
  const [o] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, a.orderId))
    .limit(1);
  return o ?? null;
}

export async function unassignDeliveryPartner(
  orderRef: string,
  opts: { note?: string } = {},
): Promise<DeliveryResult> {
  const order = await getOrderByRef(orderRef);
  if (!order) return { ok: false, error: "Order not found", status: 404 };

  const [a] = await db
    .select()
    .from(deliveryAssignments)
    .where(eq(deliveryAssignments.orderId, order.id))
    .limit(1);
  if (!a) return { ok: false, error: "No assignment", status: 404 };
  if (a.status === "delivered" || a.status === "cancelled") {
    return { ok: false, error: "Assignment terminal", status: 409 };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(deliveryAssignments)
      .set({ status: "cancelled" })
      .where(eq(deliveryAssignments.id, a.id));
    if (a.partnerId != null) {
      await tx
        .update(deliveryPartners)
        .set({ status: "available" })
        .where(eq(deliveryPartners.id, a.partnerId));
    }
    if (a.riderId != null) {
      await tx
        .update(deliveryRiders)
        .set({ status: "available" })
        .where(eq(deliveryRiders.id, a.riderId));
    }
    if (a.deliveryOrderId != null) {
      // Back to the dispatch queue for a fresh rider.
      await setDeliveryTrackStatus(tx, a.deliveryOrderId, "pending");
      await appendDeliveryEvent(tx, {
        deliveryOrderId: a.deliveryOrderId,
        eventType: "DELIVERY_UNASSIGNED",
        actor: "pos",
        metadata: { note: opts.note ?? "" },
      });
    }
  });

  await publishOrderEvent(order.reference, "delivery_unassigned", "pos");
  return { ok: true, delivery: { status: "pending", terminal: false } };
}