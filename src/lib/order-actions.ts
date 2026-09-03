import { db } from "@/db";
import { orders, orderStatusEvents, customers, loyaltyLedger, notifications } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { pointsEarned } from "./loyalty";
import { num } from "./format";

import {
  canTransition,
  legacyToCanonical,
  nextStatuses,
  type OrderLifecycleStatus,
} from "./order-lifecycle";

export type TransitionResult =
  | { ok: true; order: { id: number; reference: string; status: OrderLifecycleStatus } }
  | { ok: false; status: number; error: string };

/**
 * PHASE 13 — the one place a lifecycle transition is committed. Both the POS
 * queue and any future customer-facing cancellation call this single function,
 * so the marketplace can only reflect what the POS actually did.
 */
export async function transitionOrder(
  orderRef: string,
  toStatusRaw: string,
  opts: { actor?: "pos" | "customer" | "system"; note?: string } = {},
): Promise<TransitionResult> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.reference, orderRef))
    .limit(1);
  if (!order) return { ok: false, status: 404, error: "Order not found" };

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
  if (toStatusRaw === "completed") timestamps.completedAt = now;
  if (toStatusRaw === "cancelled") timestamps.cancelledAt = now;

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

    // PHASE 21 — notify on meaningful lifecycle transitions.
    const kindMap: Record<string, "order_accepted" | "order_ready" | "order_completed"> = {
      accepted: "order_accepted",
      ready: "order_ready",
      completed: "order_completed",
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
              : `Your order ${order.reference} is complete. Enjoy!`,
        channel: "push",
      });
    }

    if (toStatusRaw === "completed" && order.customerId) {
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

  return {
    ok: true,
    order: {
      id: updated.id,
      reference: updated.reference,
      status: legacyToCanonical(updated.status),
    },
  };
}
