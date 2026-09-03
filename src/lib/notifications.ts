import { db } from "@/db";
import { notifications, orders, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { num } from "./format";

/**
 * PHASE 21 — notifications outbox.
 *
 * The marketplace + POS enqueue lifecycle notifications here. A Phase 24
 * delivery worker (Push / WhatsApp / SMS / Email) flushes the outbox — this
 * keeps event types authoritative now and channels pluggable later.
 */

export type NotificationKind =
  | "order_placed"
  | "order_accepted"
  | "order_ready"
  | "order_completed"
  | "payment_successful";

export async function notify(opts: {
  orderId: number;
  kind: NotificationKind;
  channel?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const [row] = await db
      .select({
        customerId: orders.customerId,
        phone: orders.customerPhone,
        name: orders.customerName,
        reference: orders.reference,
        restaurantName: restaurants.name,
        total: orders.total,
      })
      .from(orders)
      .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .where(eq(orders.id, opts.orderId))
      .limit(1);
    if (!row) return;

    const messages: Record<NotificationKind, string> = {
      order_placed: `${row.restaurantName} was sent your order ${row.reference}.`,
      order_accepted: `${row.restaurantName} accepted your order ${row.reference}.`,
      order_ready: `${row.restaurantName} says your order ${row.reference} is ready.`,
      order_completed: `Your ${row.restaurantName} order ${row.reference} is complete. Enjoy!`,
      payment_successful: `Payment of $${num(row.total).toFixed(2)} for order ${row.reference} was successful.`,
    };

    await db.insert(notifications).values({
      customerId: row.customerId,
      phone: row.phone,
      orderId: opts.orderId,
      kind: opts.kind,
      message: messages[opts.kind],
      channel: opts.channel ?? "push",
      meta: JSON.stringify(opts.meta ?? {}),
    });
  } catch (e) {
    // Notifications must never break ordering.
    console.error("notify failed", e);
  }
}
