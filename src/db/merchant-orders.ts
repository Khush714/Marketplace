import "server-only";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { merchantOrderEvents, orders, restaurants } from "@/db/schema";
import { recordIntegrationAudit } from "@/db/queries";
import { handleCancelledOrderPayment } from "@/integrations/payments/refund";

export const MERCHANT_ORDER_STATUSES = ["PLACED", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "REJECTED", "CANCELLED"] as const;
export type MerchantOrderStatus = (typeof MERCHANT_ORDER_STATUSES)[number];
const ACTIVE: MerchantOrderStatus[] = ["PLACED", "ACCEPTED", "PREPARING", "READY"];
const TERMINAL = new Set<MerchantOrderStatus>(["COMPLETED", "REJECTED", "CANCELLED"]);
const TRANSITIONS: Record<MerchantOrderStatus, readonly MerchantOrderStatus[]> = {
  PLACED: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [], REJECTED: [], CANCELLED: [],
};

export interface MerchantOrderListOptions {
  status: "active" | "all" | "cancelled" | MerchantOrderStatus;
  page: number;
  limit: number;
  search?: string;
  from?: Date;
  toExclusive?: Date;
}

/** Lists canonical Marketplace orders scoped to a server-resolved merchant ID. */
export async function listMerchantOrders(restaurantId: number, options: MerchantOrderListOptions) {
  const [restaurant] = await db.select({ id: restaurants.id }).from(restaurants)
    .where(eq(restaurants.id, restaurantId)).limit(1);
  if (!restaurant) return null;
  const statuses = options.status === "active"
    ? ACTIVE
    : options.status === "all"
      ? [...MERCHANT_ORDER_STATUSES]
      : options.status === "cancelled"
        ? ["CANCELLED", "REJECTED"] as MerchantOrderStatus[]
        : [options.status];
  // Online payment orders stay out of the merchant inbox until the Marketplace
  // payment provider confirms capture. COD orders may appear while unpaid.
  const paymentReady = or(eq(orders.paymentMethod, "cod"), eq(orders.paymentStatus, "PAID"));
  const filters = [eq(orders.restaurantId, restaurantId), eq(orders.merchantManaged, true), inArray(orders.merchantStatus, statuses), paymentReady];
  if (options.search) filters.push(ilike(orders.code, `%${options.search.replace(/[\\%_]/g, "")}%`));
  if (options.from) filters.push(gte(orders.createdAt, options.from));
  if (options.toExclusive) filters.push(lt(orders.createdAt, options.toExclusive));
  const filter = and(...filters);
  const [rows, countRows] = await Promise.all([
    db.select().from(orders).where(filter).orderBy(desc(orders.createdAt))
      .limit(options.limit + 1).offset((options.page - 1) * options.limit),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(filter),
  ]);
  const hasMore = rows.length > options.limit;
  return {
    orders: rows.slice(0, options.limit).map((order) => ({
      code: order.code,
      restaurantName: order.restaurantName,
      items: order.items,
      addressLabel: order.addressLabel,
      addressText: order.addressText,
      customerName: order.customerName,
      phone: order.phone,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      instructions: order.instructions,
      subtotalCents: order.subtotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      platformFeeCents: order.platformFeeCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      createdAt: order.createdAt.toISOString(),
      status: order.merchantStatus as MerchantOrderStatus,
      statusUpdatedAt: order.merchantStatusUpdatedAt.toISOString(),
      prepMinutes: order.merchantPrepMinutes,
      rejectionReason: order.merchantRejectionReason,
      fulfilment: order.merchantFulfilment,
    })),
    hasMore,
    page: options.page,
    total: Number(countRows[0]?.count ?? 0),
  };
}

export type MerchantTransitionResult =
  | { ok: true; order: { code: string; status: MerchantOrderStatus; statusUpdatedAt: string; prepMinutes: number | null; rejectionReason: string | null } }
  | { ok: false; reason: "NOT_FOUND" | "CONFLICT" | "INVALID_TRANSITION" | "INVALID_INPUT" };

/** Performs a tenant-scoped compare-and-set transition and appends an event in the same transaction. */
export async function transitionMerchantOrder(input: {
  restaurantId: number;
  orderCode: string;
  expectedStatus: MerchantOrderStatus;
  nextStatus: MerchantOrderStatus;
  prepMinutes?: number;
  reason?: string;
}): Promise<MerchantTransitionResult> {
  if (!TRANSITIONS[input.expectedStatus]?.includes(input.nextStatus)) return { ok: false, reason: "INVALID_TRANSITION" };
  if (input.nextStatus === "ACCEPTED" && (!Number.isInteger(input.prepMinutes) || (input.prepMinutes ?? 0) < 5 || (input.prepMinutes ?? 0) > 180)) {
    return { ok: false, reason: "INVALID_INPUT" };
  }
  if (input.nextStatus === "REJECTED" && !input.reason?.trim()) return { ok: false, reason: "INVALID_INPUT" };
  if (input.nextStatus === "CANCELLED" && !input.reason?.trim()) return { ok: false, reason: "INVALID_INPUT" };

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders)
      .where(and(eq(orders.code, input.orderCode), eq(orders.restaurantId, input.restaurantId), eq(orders.merchantManaged, true))).limit(1);
    if (!current) return { kind: "NOT_FOUND" } as const;
    if (current.merchantStatus !== input.expectedStatus) return { kind: "CONFLICT" } as const;
    if (TERMINAL.has(current.merchantStatus as MerchantOrderStatus)) return { kind: "INVALID_TRANSITION" } as const;
    // A merchant may complete only pickup orders. Delivery completion requires a trusted fulfilment event.
    if (input.nextStatus === "COMPLETED" && current.merchantFulfilment !== "pickup") return { kind: "INVALID_TRANSITION" } as const;

    const [updated] = await tx.update(orders).set({
      merchantStatus: input.nextStatus,
      merchantStatusUpdatedAt: now,
      ...(input.nextStatus === "ACCEPTED" ? { merchantPrepMinutes: input.prepMinutes! } : {}),
      ...(input.nextStatus === "REJECTED" ? { merchantRejectionReason: input.reason!.trim().slice(0, 250) } : {}),
    }).where(and(eq(orders.id, current.id), eq(orders.restaurantId, input.restaurantId), eq(orders.merchantStatus, input.expectedStatus)))
      .returning({ code: orders.code, externalOrderId: orders.externalOrderId, merchantStatus: orders.merchantStatus, merchantStatusUpdatedAt: orders.merchantStatusUpdatedAt, merchantPrepMinutes: orders.merchantPrepMinutes, merchantRejectionReason: orders.merchantRejectionReason });
    if (!updated) return { kind: "CONFLICT" } as const;
    await tx.insert(merchantOrderEvents).values({ orderId: current.id, restaurantId: input.restaurantId, fromStatus: input.expectedStatus, toStatus: input.nextStatus, reason: input.reason?.trim().slice(0, 250) ?? "" });
    return { kind: "UPDATED", updated } as const;
  });

  if (result.kind !== "UPDATED") {
    if (result.kind === "NOT_FOUND") return { ok: false, reason: "NOT_FOUND" };
    if (result.kind === "CONFLICT") return { ok: false, reason: "CONFLICT" };
    return { ok: false, reason: "INVALID_TRANSITION" };
  }
  await recordIntegrationAudit(input.restaurantId, "MERCHANT_ORDER_STATUS_UPDATED", { actor: "partner" }, {
    order_code: result.updated.code, from_status: input.expectedStatus, to_status: input.nextStatus,
  }).catch(() => undefined);
  // Merchant rejection/cancellation must also enter the existing payment
  // settlement path. Captured payments become REFUND_PENDING; uncaptured ones
  // become PAYMENT_CANCELLED. Merchant status itself is never treated as proof
  // that a refund has completed.
  if ((input.nextStatus === "REJECTED" || input.nextStatus === "CANCELLED") && result.updated.externalOrderId) {
    await handleCancelledOrderPayment(
      input.restaurantId,
      result.updated.externalOrderId,
      input.nextStatus === "REJECTED" ? "MERCHANT_REJECTED_ORDER" : "MERCHANT_CANCELLED_ORDER",
    ).catch((error) => {
      console.error("[merchant-orders] cancellation payment settlement failed", error);
    });
  }
  return { ok: true, order: {
    code: result.updated.code,
    status: result.updated.merchantStatus as MerchantOrderStatus,
    statusUpdatedAt: result.updated.merchantStatusUpdatedAt.toISOString(),
    prepMinutes: result.updated.merchantPrepMinutes,
    rejectionReason: result.updated.merchantRejectionReason,
  } };
}


/** Server-derived overview metrics for the connected Merchant App. */
export async function getMerchantOrderSummary(restaurantId: number) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const startOfDay = new Date(`${date}T00:00:00+05:30`);
  const scope = and(
    eq(orders.restaurantId, restaurantId),
    eq(orders.merchantManaged, true),
    or(eq(orders.paymentMethod, "cod"), eq(orders.paymentStatus, "PAID")),
  );
  const [groups, [today], [completed], [latestPlaced]] = await Promise.all([
    db.select({ status: orders.merchantStatus, count: sql<number>`count(*)::int` })
      .from(orders).where(scope).groupBy(orders.merchantStatus),
    db.select({ count: sql<number>`count(*)::int` }).from(orders)
      .where(and(scope, gte(orders.createdAt, startOfDay))),
    db.select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::bigint`.mapWith(Number) })
      .from(orders).where(and(scope, eq(orders.merchantStatus, "COMPLETED"), gte(orders.merchantStatusUpdatedAt, startOfDay))),
    db.select({ code: orders.code }).from(orders)
      .where(and(scope, eq(orders.merchantStatus, "PLACED")))
      .orderBy(desc(orders.createdAt)).limit(1),
  ]);
  const counts: Record<string, number> = { new: 0, accepted: 0, preparing: 0, ready: 0, completed: 0, rejected: 0, cancelled: 0 };
  const map: Record<string, string> = { PLACED: "new", ACCEPTED: "accepted", PREPARING: "preparing", READY: "ready", COMPLETED: "completed", REJECTED: "rejected", CANCELLED: "cancelled" };
  for (const group of groups) {
    const key = map[group.status];
    if (key) counts[key] = Number(group.count);
  }
  return {
    counts,
    todaySales: Number(completed.total ?? 0),
    todayOrders: Number(today.count ?? 0),
    completedToday: Number(completed.count ?? 0),
    latestNewOrderId: latestPlaced?.code ?? null,
    settlements: [],
  };
}

export type CustomerMerchantCancelResult =
  | { kind: "NOT_MERCHANT" }
  | { kind: "NOT_FOUND" }
  | { kind: "CANCELLED"; idempotent: boolean; status: "CANCELLED" }
  | { kind: "CONFLICT"; currentStatus: string };

/** Customer cancellation for Merchant-managed orders; legacy POS orders fall through to their POS authority. */
export async function cancelMerchantOrderByCode(code: string): Promise<CustomerMerchantCancelResult> {
  const upper = code.toUpperCase();
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.code, upper)).limit(1).for("update");
    if (!current) return { kind: "NOT_FOUND" } as const;
    if (!current.merchantManaged) return { kind: "NOT_MERCHANT" } as const;
    if (current.merchantStatus === "CANCELLED") return { kind: "CANCELLED", idempotent: true, status: "CANCELLED" } as const;
    if (current.merchantStatus !== "PLACED" && current.merchantStatus !== "ACCEPTED") {
      return { kind: "CONFLICT", currentStatus: current.merchantStatus } as const;
    }
    const [updated] = await tx.update(orders).set({ merchantStatus: "CANCELLED", merchantStatusUpdatedAt: now })
      .where(and(eq(orders.id, current.id), eq(orders.merchantManaged, true), eq(orders.merchantStatus, current.merchantStatus)))
      .returning({ id: orders.id, restaurantId: orders.restaurantId, externalOrderId: orders.externalOrderId, code: orders.code, fromStatus: orders.merchantStatus });
    if (!updated) return { kind: "CONFLICT", currentStatus: current.merchantStatus } as const;
    await tx.insert(merchantOrderEvents).values({
      orderId: current.id, restaurantId: current.restaurantId, fromStatus: current.merchantStatus,
      toStatus: "CANCELLED", reason: "CUSTOMER_REQUEST",
    });
    return { kind: "CANCELLED", idempotent: false, status: "CANCELLED", restaurantId: updated.restaurantId, externalOrderId: updated.externalOrderId, orderCode: updated.code } as const;
  });
  if (result.kind === "CANCELLED" && !result.idempotent && "restaurantId" in result && result.externalOrderId) {
    await recordIntegrationAudit(result.restaurantId, "MERCHANT_ORDER_STATUS_UPDATED", { actor: "system" }, {
      order_code: result.orderCode, from_status: "PLACED_OR_ACCEPTED", to_status: "CANCELLED", reason: "CUSTOMER_REQUEST",
    }).catch(() => undefined);
    await handleCancelledOrderPayment(result.restaurantId, result.externalOrderId, "CUSTOMER_CANCELLED_ORDER").catch((error) => {
      console.error("[merchant-orders] customer cancellation payment settlement failed", error);
    });
  }
  return result.kind === "CANCELLED"
    ? { kind: "CANCELLED", idempotent: result.idempotent, status: "CANCELLED" }
    : result;
}
