import { db } from "@/db";
import { orders, orderStatusEvents, customers, loyaltyLedger, notifications } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { pointsEarned } from "./loyalty";
import { num } from "./format";
import { flushOrder } from "./push";
import { publishOrderEvent } from "./realtime";
import { appendOrderEvent, type OrderEventType } from "./order-events";
import { enqueueOutboundEvent } from "./webhook-outbox";

import {
  canTransition,
  isCanonicalStatus,
  legacyToCanonical,
  nextStatuses,
  ORDER_STATUSES,
  type OrderLifecycleStatus,
} from "./order-lifecycle";

export type TransitionResult =
  | { ok: true; order: { id: number; reference: string; status: OrderLifecycleStatus } }
  | { ok: false; status: number; error: string };

/** PHASE 10 — lifecycle status → audit-trail event key (user-facing keys). */
const LIFECYCLE_EVENT: Partial<Record<string, OrderEventType>> = {
  accepted: "ORDER_ACCEPTED",
  preparing: "PREPARING",
  ready: "READY",
  picked_up: "PICKED_UP",
  delivered: "DELIVERED",
  cancelled: "CANCELLED",
  rejected: "REJECTED",
};

/**
 * PHASE 13 — the one place a lifecycle transition is committed. Both the POS
 * queue and any future customer-facing cancellation call this single function,
 * so the marketplace can only reflect what the POS actually did.
 */
export async function transitionOrder(
  orderRef: string,
  toStatusRaw: string,
  opts: {
    actor?: "pos" | "customer" | "system";
    note?: string;
    /** PHASE 18 — tenant guard. When set, the order must belong to this restaurant. */
    restaurantId?: number;
  } = {},
): Promise<TransitionResult> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.reference, orderRef))
    .limit(1);
  if (!order) return { ok: false, status: 404, error: "Order not found" };

  // PHASE 18 — restaurant_id isolation: a signed webhook / POS key scoped to
  // one restaurant can never advance another tenant's order.
  if (opts.restaurantId !== undefined && order.restaurantId !== opts.restaurantId) {
    return {
      ok: false,
      status: 403,
      error: "Order belongs to another restaurant",
    };
  }

  // PHASE 9 — writes must use the canonical contract keys. Legacy aliases
  // (completed, pending, …) are readable but never writable, so the stored
  // value is always one of the contract statuses.
  if (!isCanonicalStatus(toStatusRaw)) {
    return {
      ok: false,
      status: 400,
      error: `"${toStatusRaw}" is not a canonical lifecycle status. Use one of: ${ORDER_STATUSES.join(", ")}.`,
    };
  }

  const fromRaw = order.status;
  if (!canTransition(fromRaw, toStatusRaw)) {
    const allowed = nextStatuses(
      (fromRaw as OrderLifecycleStatus) ?? "placed",
    );
    return {
      ok: false,
      status: 409,
      error: `Cannot move this order from "${fromRaw}" to "${toStatusRaw}". Allowed: ${allowed.join(", ") || "none (terminal)"}.`,
    };
  }

  const now = new Date();
  const actor = opts.actor ?? "pos";
  const note = (opts.note ?? "").trim();

  const timestamps: Record<string, Date | null> = {};
  if (toStatusRaw === "accepted") timestamps.acceptedAt = now;
  if (toStatusRaw === "ready") timestamps.readyAt = now;
  if (toStatusRaw === "picked_up") timestamps.pickedUpAt = now;
  if (toStatusRaw === "delivered") timestamps.deliveredAt = now;
  if (toStatusRaw === "cancelled") timestamps.cancelledAt = now;
  if (toStatusRaw === "rejected") timestamps.rejectedAt = now;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(orders)
      .set({
        status: toStatusRaw,
        statusUpdatedAt: now,
        ...timestamps,
      })
      .where(eq(orders.id, order.id))
      .returning({ id: orders.id, reference: orders.reference, status: orders.status });

    await tx.insert(orderStatusEvents).values({
      orderId: order.id,
      fromStatus: fromRaw,
      toStatus: toStatusRaw,
      actor,
      note,
    });

    // PHASE 10 — every lifecycle transition lands on the unified audit trail
    // in the same transaction, so the event can never lag the status.
    const eventType = LIFECYCLE_EVENT[toStatusRaw as keyof typeof LIFECYCLE_EVENT];
    if (eventType) {
      await appendOrderEvent(tx, {
        orderId: order.id,
        type: eventType,
        actor: actor as "system" | "pos" | "customer",
        fromStatus: fromRaw,
        toStatus: toStatusRaw,
        note,
      });
    }

    // PHASE 21 — notify on meaningful lifecycle transitions.
    const kindMap: Record<
      string,
      "order_accepted" | "order_ready" | "order_delivered" | "order_rejected"
    > = {
      accepted: "order_accepted",
      ready: "order_ready",
      delivered: "order_delivered",
      rejected: "order_rejected",
    };
    const kind = kindMap[toStatusRaw];
    if (kind) {
      await tx.insert(notifications).values({
        customerId: order.customerId,
        phone: order.customerPhone,
        orderId: order.id,
        kind,
        message:
          kind === "order_accepted"
            ? `The restaurant accepted your order ${order.reference}.`
            : kind === "order_ready"
              ? `Your order ${order.reference} is ready.`
              : kind === "order_rejected"
                ? `The restaurant couldn't take your order ${order.reference}. Please try again.`
                : `Your order ${order.reference} is delivered. Enjoy!`,
        channel: "push",
      });
    }

    if (toStatusRaw === "delivered" && order.customerId) {
      const pts = pointsEarned(num(order.total));
      if (pts > 0) {
        await tx.insert(loyaltyLedger).values({
          customerId: order.customerId,
          orderId: order.id,
          points: pts,
          reason: "earn",
        });
        await tx
          .update(customers)
          .set({
            loyaltyPoints: sql`${customers.loyaltyPoints} + ${pts}`,
          })
          .where(eq(customers.id, order.customerId));
      }
    }

    return row;
  });

  // PHASE 24 — deliver the enqueued lifecycle push immediately post-commit.
  if (updated) {
    void flushOrder(updated.id).catch((e) => {
      console.error("push flush failed", e);
    });
    void publishOrderEvent(updated.reference, updated.status, actor);

    // PHASE 36 — outbound cancellation event for a connected RestaurantAI/POS.
    if (toStatusRaw === "cancelled") {
      void enqueueOutboundEvent(updated.id, "order.cancelled").catch((e) => {
        console.error("outbox enqueue failed for cancel", updated.id, e);
      });
    }
  }

  return {
    ok: true,
    order: {
      id: updated.id,
      reference: updated.reference,
      status: legacyToCanonical(updated.status),
    },
  };
}
