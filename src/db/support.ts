import "server-only";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, supportMessages, supportThreads } from "@/db/schema";
import {
  customerSupportThreadDto,
  hasUnreadOpsReply,
  MAX_SUPPORT_MESSAGES,
  opsSupportThreadDto,
  supportThreadDto,
  type CustomerSupportThreadDto,
  type OpsSupportThreadDetail,
  type OpsSupportThreadDto,
  type SupportStatus,
} from "@/lib/support-core";

/**
 * Persistence for order-scoped support threads.
 *
 * Customer writes resolve the order by code, which the route has already
 * authenticated with the HMAC order token; ops writes take a thread id and are
 * authenticated by `x-ops-token`. No function here accepts a caller-supplied
 * author, order identity or timestamp — those are fixed by the query or the
 * route so a thread can never be attributed to the wrong order.
 */

export type CustomerThreadResult = {
  orderFound: boolean;
  thread: CustomerSupportThreadDto | null;
};

/** The thread a customer sees, or `null` before they have written anything. */
export async function customerSupportThread(code: string): Promise<CustomerThreadResult> {
  const [order] = await db.select({ id: orders.id }).from(orders)
    .where(eq(orders.code, code)).limit(1);
  if (!order) return { orderFound: false, thread: null };

  const [thread] = await db.select().from(supportThreads)
    .where(eq(supportThreads.orderId, order.id)).limit(1);
  if (!thread) return { orderFound: true, thread: null };

  const messages = await db.select().from(supportMessages)
    .where(eq(supportMessages.threadId, thread.id))
    .orderBy(asc(supportMessages.createdAt))
    .limit(MAX_SUPPORT_MESSAGES);
  return { orderFound: true, thread: customerSupportThreadDto(thread, messages) };
}

export type CustomerSendResult =
  | { kind: "OK"; thread: CustomerSupportThreadDto }
  | { kind: "NOT_FOUND" }
  | { kind: "CONFLICT" };

/**
 * Append a customer message, creating the one thread per order on first use.
 *
 * The row is locked and the insert upserts on the unique order index, so two
 * tabs sending together share one thread instead of forking the conversation.
 * A customer message reopens a resolved thread because the customer is the one
 * reporting that the issue is still live.
 */
export async function customerSendSupportMessage(code: string, body: string): Promise<CustomerSendResult> {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id, restaurantId: orders.restaurantId })
      .from(orders).where(eq(orders.code, code)).limit(1).for("update");
    if (!order) return { kind: "NOT_FOUND" as const };

    let [thread] = await tx.select().from(supportThreads)
      .where(eq(supportThreads.orderId, order.id)).limit(1);
    if (!thread) {
      await tx.insert(supportThreads).values({ orderId: order.id, restaurantId: order.restaurantId })
        .onConflictDoNothing({ target: supportThreads.orderId });
      [thread] = await tx.select().from(supportThreads)
        .where(eq(supportThreads.orderId, order.id)).limit(1);
    }
    if (!thread) return { kind: "CONFLICT" as const };

    const [message] = await tx.insert(supportMessages).values({
      threadId: thread.id,
      authorRole: "CUSTOMER",
      body,
    }).returning();
    await tx.update(supportThreads).set({
      status: "OPEN",
      lastMessage: body,
      lastAuthorRole: "CUSTOMER",
      lastMessageAt: message.createdAt,
      // Replying means they have read the thread, including any earlier ops
      // answer — otherwise the badge would survive their own response.
      customerLastReadAt: message.createdAt,
      messageCount: sql`${supportThreads.messageCount} + 1`,
      resolvedAt: null,
      updatedAt: new Date(),
    }).where(eq(supportThreads.id, thread.id));

    const [fresh] = await tx.select().from(supportThreads)
      .where(eq(supportThreads.id, thread.id)).limit(1);
    const messages = await tx.select().from(supportMessages)
      .where(eq(supportMessages.threadId, thread.id))
      .orderBy(asc(supportMessages.createdAt))
      .limit(MAX_SUPPORT_MESSAGES);
    return { kind: "OK" as const, thread: customerSupportThreadDto(fresh, messages) };
  });
  return result;
}

/**
 * Advance the read watermark for one order's thread.
 *
 * Idempotent: a repeated mark (two tabs, a double tap) lands on the same reply
 * and never touches message history or the ops-visible fields. An order without
 * a thread has nothing to mark, which is success rather than an error — the
 * customer has no way to know a thread does not exist yet.
 */
export async function markSupportThreadRead(code: string): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select({ id: orders.id }).from(orders)
      .where(eq(orders.code, code)).limit(1);
    if (!order) return false;
    const [thread] = await tx.select({
      id: supportThreads.id,
      lastMessageAt: supportThreads.lastMessageAt,
    }).from(supportThreads)
      .where(eq(supportThreads.orderId, order.id)).limit(1).for("update");
    if (!thread) return false;
    // Stamp the reply that was just read, not `now()`: an ops reply arriving
    // after this lock has to stay unread instead of being swallowed by the mark.
    await tx.update(supportThreads).set({
      customerLastReadAt: thread.lastMessageAt,
      updatedAt: new Date(),
    }).where(eq(supportThreads.id, thread.id));
    return true;
  });
  return result;
}

/**
 * Which of these orders have an unread ops reply, in one bounded query.
 *
 * The predicate is the pure `hasUnreadOpsReply` rule applied to the same
 * denormalised fields the thread DTO uses, so a badge in a list and a badge on
 * the conversation cannot disagree. Callers pass already-authorised codes:
 * this is a projection over them, never a way to discover a thread.
 */
export async function unreadSupportCodes(codes: readonly string[]): Promise<Set<string>> {
  const upper = codes.slice(0, 30).map((code) => code.toUpperCase());
  if (!upper.length) return new Set();
  const rows = await db.select({
    code: orders.code,
    lastAuthorRole: supportThreads.lastAuthorRole,
    lastMessageAt: supportThreads.lastMessageAt,
    customerLastReadAt: supportThreads.customerLastReadAt,
  }).from(supportThreads)
    .innerJoin(orders, eq(orders.id, supportThreads.orderId))
    .where(inArray(orders.code, upper))
    .limit(30);
  return new Set(rows.filter(hasUnreadOpsReply).map((row) => row.code));
}

/** Ops inbox summaries, newest activity first. One bounded indexed query. */
export async function opsListSupportThreads(
  status: SupportStatus | "all",
  limit = 50,
): Promise<OpsSupportThreadDto[]> {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await db.select({
    id: supportThreads.id,
    status: supportThreads.status,
    messageCount: supportThreads.messageCount,
    lastMessage: supportThreads.lastMessage,
    lastAuthorRole: supportThreads.lastAuthorRole,
    lastMessageAt: supportThreads.lastMessageAt,
    resolvedAt: supportThreads.resolvedAt,
    createdAt: supportThreads.createdAt,
    updatedAt: supportThreads.updatedAt,
    orderCode: orders.code,
    restaurantName: orders.restaurantName,
    customerName: orders.customerName,
  }).from(supportThreads)
    .innerJoin(orders, eq(orders.id, supportThreads.orderId))
    .where(status === "all" ? undefined : eq(supportThreads.status, status))
    .orderBy(desc(supportThreads.lastMessageAt))
    .limit(bounded);
  return rows.map(opsSupportThreadDto);
}

/** Full conversation for one thread, newest activity header from the order. */
export async function opsSupportThread(threadId: string): Promise<OpsSupportThreadDetail | null> {
  const [row] = await db.select({
    id: supportThreads.id,
    status: supportThreads.status,
    messageCount: supportThreads.messageCount,
    resolvedAt: supportThreads.resolvedAt,
    createdAt: supportThreads.createdAt,
    updatedAt: supportThreads.updatedAt,
    orderCode: orders.code,
    restaurantName: orders.restaurantName,
    customerName: orders.customerName,
  }).from(supportThreads)
    .innerJoin(orders, eq(orders.id, supportThreads.orderId))
    .where(eq(supportThreads.id, threadId)).limit(1);
  if (!row) return null;

  const messages = await db.select().from(supportMessages)
    .where(eq(supportMessages.threadId, threadId))
    .orderBy(asc(supportMessages.createdAt))
    .limit(MAX_SUPPORT_MESSAGES);
  return {
    ...supportThreadDto(row, messages),
    orderCode: row.orderCode,
    restaurantName: row.restaurantName,
    customerName: row.customerName,
  };
}

export type OpsThreadResult =
  | { kind: "OK"; thread: OpsSupportThreadDetail }
  | { kind: "NOT_FOUND" };

/** Ops reply. The author role is stamped by this function, not the request. */
export async function opsReplyToSupportThread(threadId: string, body: string): Promise<OpsThreadResult> {
  const ok = await db.transaction(async (tx) => {
    const [thread] = await tx.select({ id: supportThreads.id }).from(supportThreads)
      .where(eq(supportThreads.id, threadId)).limit(1).for("update");
    if (!thread) return false;

    const [message] = await tx.insert(supportMessages).values({
      threadId,
      authorRole: "OPS",
      body,
    }).returning();
    await tx.update(supportThreads).set({
      lastMessage: body,
      lastAuthorRole: "OPS",
      lastMessageAt: message.createdAt,
      messageCount: sql`${supportThreads.messageCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(supportThreads.id, threadId));
    return true;
  });
  if (!ok) return { kind: "NOT_FOUND" };
  const thread = await opsSupportThread(threadId);
  if (!thread) return { kind: "NOT_FOUND" };
  return { kind: "OK", thread };
}

/** Resolve or reopen a thread. Timestamps come from the server, not the caller. */
export async function opsSetSupportStatus(
  threadId: string,
  status: SupportStatus,
): Promise<OpsThreadResult> {
  const [updated] = await db.update(supportThreads).set({
    status,
    resolvedAt: status === "RESOLVED" ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(supportThreads.id, threadId)).returning({ id: supportThreads.id });
  if (!updated) return { kind: "NOT_FOUND" };
  const thread = await opsSupportThread(threadId);
  if (!thread) return { kind: "NOT_FOUND" };
  return { kind: "OK", thread };
}
