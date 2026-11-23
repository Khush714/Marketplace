import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { customerNotifications, orders } from "@/db/schema";
import {
  isInboxToken,
  notificationCopy,
  notificationDedupeKey,
  type CustomerNotificationKind,
} from "@/lib/customer-notification-copy";

/** Only the SHA-256 hash of a browser token is ever persisted or queried. */
export function hashInboxToken(token: string): string {
  if (!isInboxToken(token)) throw new Error("Invalid inbox token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const INBOX_HASH_PATTERN = /^[a-f0-9]{64}$/;

export function isInboxHash(value: unknown): value is string {
  return typeof value === "string" && INBOX_HASH_PATTERN.test(value);
}

/**
 * Best-effort customer notification. Notification writes must never fail an
 * order, payment, cancellation or review write, so failures are logged and
 * swallowed. Orders without a hashed device inbox token are skipped.
 */
export async function recordOrderNotification(input: {
  orderId: number;
  kind: CustomerNotificationKind;
  detail?: string;
}): Promise<void> {
  const { orderId, kind, detail = "" } = input;
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return;
  try {
    const [order] = await db
      .select({
        id: orders.id,
        restaurantId: orders.restaurantId,
        inboxHash: orders.customerInboxHash,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order?.inboxHash || !isInboxHash(order.inboxHash)) return;

    const copy = notificationCopy(kind, detail);
    await db
      .insert(customerNotifications)
      .values({
        orderId: order.id,
        restaurantId: order.restaurantId,
        inboxHash: order.inboxHash,
        kind,
        title: copy.title,
        body: copy.body,
        dedupeKey: notificationDedupeKey(order.id, kind, detail),
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error("[customer-notifications] record failed", { orderId, kind }, error);
  }
}

/** Convenience hook for writers that know the resulting order facts. */
export async function notifyOrderState(orderId: number, state: {
  status?: string;
  deliveryState?: string;
  paymentStatus?: string;
}): Promise<void> {
  const writes: Promise<void>[] = [];
  if (state.status) writes.push(recordOrderNotification({ orderId, kind: "order_status", detail: state.status }));
  if (state.deliveryState && state.deliveryState !== "NOT_STARTED") {
    writes.push(recordOrderNotification({ orderId, kind: "delivery", detail: state.deliveryState }));
  }
  if (state.paymentStatus && state.paymentStatus !== "UNPAID") {
    writes.push(recordOrderNotification({ orderId, kind: "payment", detail: state.paymentStatus }));
  }
  await Promise.all(writes);
}

export type CustomerNotificationDto = {
  id: number;
  orderId: number;
  orderCode: string;
  kind: CustomerNotificationKind | string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

/** A token-scoped inbox: only rows for this browser's hashed token are returned. */
export async function listCustomerNotifications(inboxHash: string, limit = 50): Promise<{
  notifications: CustomerNotificationDto[];
  unreadCount: number;
}> {
  if (!isInboxHash(inboxHash)) return { notifications: [], unreadCount: 0 };
  const capped = Math.max(1, Math.min(100, Math.floor(limit)));

  const [rows, [unread]] = await Promise.all([
    db
      .select({
        id: customerNotifications.id,
        orderId: customerNotifications.orderId,
        orderCode: orders.code,
        kind: customerNotifications.kind,
        title: customerNotifications.title,
        body: customerNotifications.body,
        readAt: customerNotifications.readAt,
        createdAt: customerNotifications.createdAt,
      })
      .from(customerNotifications)
      .innerJoin(orders, eq(customerNotifications.orderId, orders.id))
      .where(eq(customerNotifications.inboxHash, inboxHash))
      .orderBy(desc(customerNotifications.createdAt), desc(customerNotifications.id))
      .limit(capped),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(customerNotifications)
      .where(and(eq(customerNotifications.inboxHash, inboxHash), isNull(customerNotifications.readAt))),
  ]);

  return {
    notifications: rows.map((row) => ({
      ...row,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    })),
    unreadCount: unread?.count ?? 0,
  };
}

/** Mark one, several, or every unread notification in this token-scoped inbox as read. */
export async function markCustomerNotificationsRead(inboxHash: string, ids: number[] | "all"): Promise<number> {
  if (!isInboxHash(inboxHash)) return 0;
  const conditions: SQL[] = [eq(customerNotifications.inboxHash, inboxHash), isNull(customerNotifications.readAt)];
  if (ids !== "all") {
    const validIds = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
    if (!validIds.length) return 0;
    conditions.push(inArray(customerNotifications.id, validIds));
  }
  const updated = await db
    .update(customerNotifications)
    .set({ readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: customerNotifications.id });
  return updated.length;
}
