import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderEvents } from "@/db/schema";

/**
 * PHASE 10 — order events audit trail.
 *
 * One append-only event list per order, recording BOTH the lifecycle
 * transitions (ORDER_ACCEPTED, PREPARING, READY, …) and the domain milestones
 * that are not status changes (PAYMENT_CONFIRMED, ORDER_SENT_TO_RESTAURANT,
 * DELIVERY_ASSIGNED, rider leg, refunds). That single chronological list is
 * what the customer page and the POS integration/debugging surface both read.
 *
 * `appendOrderEvent` accepts either the shared `db` or a caller's transaction
 * so the event is committed atomically with the state it describes — an audit
 * row is never written for an action that rolled back.
 */
export type OrderEventType =
  | "ORDER_PLACED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_PARTIAL_REFUNDED"
  | "ORDER_SENT_TO_RESTAURANT"
  | "ORDER_ACCEPTED"
  | "PREPARING"
  | "READY"
  | "PICKED_UP"
  | "DELIVERED"
  | "CANCELLED"
  | "REJECTED"
  | "DELIVERY_ASSIGNED"
  | "RIDER_ACCEPTED"
  | "RIDER_AT_RESTAURANT"
  | "RIDER_OUT_FOR_DELIVERY"
  | "RIDER_ARRIVING"
  | "RIDER_PICKED_UP"
  | "RIDER_CANCELLED";

export type OrderEventActor =
  | "system"
  | "pos"
  | "customer"
  | "payment"
  | "rider";

export const ORDER_EVENT_LABELS: Record<OrderEventType, string> = {
  ORDER_PLACED: "Order placed",
  PAYMENT_CONFIRMED: "Payment confirmed",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_REFUNDED: "Payment refunded",
  PAYMENT_PARTIAL_REFUNDED: "Payment partially refunded",
  ORDER_SENT_TO_RESTAURANT: "Sent to restaurant",
  ORDER_ACCEPTED: "Restaurant accepted",
  PREPARING: "Preparing",
  READY: "Ready",
  PICKED_UP: "Picked up",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
  DELIVERY_ASSIGNED: "Rider assigned",
  RIDER_ACCEPTED: "Rider accepted",
  RIDER_AT_RESTAURANT: "Rider at restaurant",
  RIDER_OUT_FOR_DELIVERY: "Out for delivery",
  RIDER_ARRIVING: "Rider arriving",
  RIDER_PICKED_UP: "Rider picked up",
  RIDER_CANCELLED: "Rider cancelled",
};

export function orderEventLabel(type: string): string {
  return ORDER_EVENT_LABELS[type as OrderEventType] ?? type;
}

export type OrderEventInput = {
  orderId: number;
  type: OrderEventType;
  actor?: OrderEventActor;
  /** Raw pre-transition status for lifecycle events (null for milestones). */
  fromStatus?: string | null;
  /** Raw post-transition status for lifecycle events (null for milestones). */
  toStatus?: string | null;
  meta?: Record<string, unknown>;
  note?: string;
};

export type OrderEventView = {
  type: OrderEventType;
  label: string;
  actor: string;
  from: string | null;
  to: string | null;
  meta: Record<string, unknown>;
  note: string;
  at: string; // ISO
};

/** Shared `db` or any caller transaction (the tx from `db.transaction`). */
export type OrderEventConnection = {
  [K in "insert" | "select" | "update" | "delete"]: K extends "insert"
    ? typeof db.insert
    : K extends "select"
      ? typeof db.select
      : K extends "update"
        ? typeof db.update
        : typeof db.delete;
};

export async function appendOrderEvent(
  conn: OrderEventConnection,
  input: OrderEventInput,
): Promise<void> {
  await conn.insert(orderEvents).values({
    orderId: input.orderId,
    type: input.type,
    actor: input.actor ?? "system",
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    meta: JSON.stringify(input.meta ?? {}),
    note: input.note ?? "",
  });
}

/** Full chronological audit trail for one order, oldest first. */
export async function listOrderEvents(
  orderId: number,
): Promise<OrderEventView[]> {
  const rows = await db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.createdAt));
  return rows.map((r) => ({
    type: r.type as OrderEventType,
    label: orderEventLabel(r.type),
    actor: r.actor,
    from: r.fromStatus,
    to: r.toStatus,
    meta: parseMeta(r.meta),
    note: r.note,
    at: r.createdAt.toISOString(),
  }));
}

function parseMeta(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}