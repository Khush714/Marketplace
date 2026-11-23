import "server-only";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { merchantOrderEvents, orders, restaurants } from "@/db/schema";
import { recordIntegrationAudit } from "@/db/queries";
import { feedbackDto } from "@/lib/order-feedback";
import { merchantSyncVersion, type MerchantSyncSnapshot, type MerchantSyncVersion } from "@/lib/merchant-sync";
import { handleCancelledOrderPayment } from "@/integrations/payments/refund";
import { recordOrderNotification } from "@/lib/customer-notifications";

export const MERCHANT_ORDER_STATUSES = ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "REJECTED", "CANCELLED"] as const;
export type MerchantOrderStatus = (typeof MERCHANT_ORDER_STATUSES)[number];
const ACTIVE: MerchantOrderStatus[] = ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];
const TERMINAL = new Set<MerchantOrderStatus>(["COMPLETED", "REJECTED", "CANCELLED"]);
const TRANSITIONS: Record<MerchantOrderStatus, readonly MerchantOrderStatus[]> = {
  PLACED: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "CANCELLED"],
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
      // The Merchant App reads this nested object and exposes the same five
      // fields on its own Order DTO. Timestamps are ISO strings; no internal
      // order id or code is repeated inside the review payload.
      feedback: feedbackDto(order),
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
    // Only a delivery order can be dispatched to a rider, and a delivery may
    // only be completed once it has been sent out. Pickup keeps its direct
    // ready → completed handoff.
    if (input.nextStatus === "OUT_FOR_DELIVERY" && current.merchantFulfilment !== "delivery") return { kind: "INVALID_TRANSITION" } as const;
    if (input.nextStatus === "COMPLETED" && current.merchantFulfilment !== "pickup" && current.merchantStatus !== "OUT_FOR_DELIVERY") return { kind: "INVALID_TRANSITION" } as const;

    const [updated] = await tx.update(orders).set({
      merchantStatus: input.nextStatus,
      merchantStatusUpdatedAt: now,
      ...(input.nextStatus === "ACCEPTED" ? { merchantPrepMinutes: input.prepMinutes! } : {}),
      ...(input.nextStatus === "REJECTED" ? { merchantRejectionReason: input.reason!.trim().slice(0, 250) } : {}),
      // Mirror to POS/integration status for true bidirectional sync
      ...(input.nextStatus === "ACCEPTED" ? { integrationStatus: "ACCEPTED" } : {}),
      ...(input.nextStatus === "PREPARING" ? { integrationStatus: "PREPARING" } : {}),
      ...(input.nextStatus === "READY" ? { integrationStatus: "READY" } : {}),
      ...(input.nextStatus === "OUT_FOR_DELIVERY" ? { integrationStatus: "OUT_FOR_DELIVERY" } : {}),
      ...(input.nextStatus === "COMPLETED" ? { integrationStatus: "COMPLETED" } : {}),
      ...(input.nextStatus === "REJECTED" ? { integrationStatus: "REJECTED" } : {}),
      ...(input.nextStatus === "CANCELLED" ? { integrationStatus: "CANCELLED" } : {}),
      statusUpdatedAt: now,
    }).where(and(eq(orders.id, current.id), eq(orders.restaurantId, input.restaurantId), eq(orders.merchantStatus, input.expectedStatus)))
      .returning({ id: orders.id, code: orders.code, externalOrderId: orders.externalOrderId, merchantStatus: orders.merchantStatus, merchantStatusUpdatedAt: orders.merchantStatusUpdatedAt, merchantPrepMinutes: orders.merchantPrepMinutes, merchantRejectionReason: orders.merchantRejectionReason });
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

  // Customer-facing copy after the transition has committed. A failed write is
  // swallowed by the emitter; the partner's status change is already durable.
  await recordOrderNotification({ orderId: result.updated.id, kind: "order_status", detail: input.nextStatus });
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


export type MerchantFulfilment = "pickup" | "delivery";
export const MERCHANT_FULFILMENTS = ["pickup", "delivery"] as const;

export type MerchantFulfilmentResult =
  | { ok: true; order: { code: string; status: MerchantOrderStatus; statusUpdatedAt: string; prepMinutes: number | null; rejectionReason: string | null; fulfilment: MerchantFulfilment; addressText: string } }
  | { ok: false; reason: "NOT_FOUND" | "CONFLICT" | "INVALID_TRANSITION" | "INVALID_INPUT" | "FULFILMENT_DISABLED" | "ADDRESS_REQUIRED" };

/**
 * Changes how an active merchant-managed order is fulfilled.
 *
 * The merchant may switch between pickup and delivery while the order is still
 * in flight. Terminal orders are read-only, the target option must be enabled
 * for the restaurant, and delivery requires a reachable address. The change is
 * recorded against the order's current status so the audit trail keeps the
 * fulfilment history without inventing a status transition.
 */
export async function updateMerchantOrderFulfilment(input: {
  restaurantId: number;
  orderCode: string;
  fulfilment: MerchantFulfilment;
  addressText?: string;
}): Promise<MerchantFulfilmentResult> {
  if (!(MERCHANT_FULFILMENTS as readonly string[]).includes(input.fulfilment)) return { ok: false, reason: "INVALID_INPUT" };
  const addressText = input.addressText?.trim().slice(0, 500) ?? "";
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders)
      .where(and(eq(orders.code, input.orderCode), eq(orders.restaurantId, input.restaurantId), eq(orders.merchantManaged, true)))
      .limit(1).for("update");
    if (!current) return { kind: "NOT_FOUND" } as const;
    if (TERMINAL.has(current.merchantStatus as MerchantOrderStatus)) return { kind: "INVALID_TRANSITION" } as const;
    // Once a delivery is with the rider it can no longer become a pickup; an
    // address correction is still allowed through the same path.
    if (current.merchantStatus === "OUT_FOR_DELIVERY" && input.fulfilment === "pickup") return { kind: "INVALID_TRANSITION" } as const;

    const [restaurant] = await tx.select({
      pickupEnabled: restaurants.merchantPickupEnabled,
      deliveryEnabled: restaurants.merchantDeliveryEnabled,
    }).from(restaurants).where(eq(restaurants.id, input.restaurantId)).limit(1);
    if (!restaurant) return { kind: "NOT_FOUND" } as const;
    if (input.fulfilment === "pickup" && !restaurant.pickupEnabled) return { kind: "FULFILMENT_DISABLED" } as const;
    if (input.fulfilment === "delivery" && !restaurant.deliveryEnabled) return { kind: "FULFILMENT_DISABLED" } as const;

    const currentFulfilment: MerchantFulfilment = current.merchantFulfilment === "pickup" ? "pickup" : "delivery";
    const nextAddress = addressText || current.addressText;
    if (input.fulfilment === "delivery" && !nextAddress.trim()) return { kind: "ADDRESS_REQUIRED" } as const;

    const fulfilmentChanged = input.fulfilment !== currentFulfilment;
    const addressChanged = Boolean(addressText) && addressText !== current.addressText;
    if (!fulfilmentChanged && !addressChanged) return { kind: "UNCHANGED", order: current } as const;

    const [updated] = await tx.update(orders).set({
      merchantFulfilment: input.fulfilment,
      ...(addressChanged ? { addressText: nextAddress } : {}),
    }).where(and(eq(orders.id, current.id), eq(orders.restaurantId, input.restaurantId))).returning({
      code: orders.code,
      merchantStatus: orders.merchantStatus,
      merchantStatusUpdatedAt: orders.merchantStatusUpdatedAt,
      merchantPrepMinutes: orders.merchantPrepMinutes,
      merchantRejectionReason: orders.merchantRejectionReason,
      merchantFulfilment: orders.merchantFulfilment,
      addressText: orders.addressText,
    });
    if (!updated) return { kind: "CONFLICT" } as const;

    const reason = fulfilmentChanged
      ? `Fulfilment changed from ${currentFulfilment} to ${input.fulfilment} by merchant`
      : "Delivery address updated by merchant";
    await tx.insert(merchantOrderEvents).values({
      orderId: current.id,
      restaurantId: input.restaurantId,
      fromStatus: current.merchantStatus,
      toStatus: current.merchantStatus,
      reason: reason.slice(0, 250),
    });
    return { kind: "UPDATED", updated, previousFulfilment: currentFulfilment } as const;
  });

  if (result.kind === "NOT_FOUND") return { ok: false, reason: "NOT_FOUND" };
  if (result.kind === "CONFLICT") return { ok: false, reason: "CONFLICT" };
  if (result.kind === "INVALID_TRANSITION") return { ok: false, reason: "INVALID_TRANSITION" };
  if (result.kind === "FULFILMENT_DISABLED") return { ok: false, reason: "FULFILMENT_DISABLED" };
  if (result.kind === "ADDRESS_REQUIRED") return { ok: false, reason: "ADDRESS_REQUIRED" };

  const updated = result.kind === "UPDATED" ? result.updated : result.order;
  if (result.kind === "UPDATED") {
    await recordIntegrationAudit(input.restaurantId, "MERCHANT_ORDER_FULFILMENT_UPDATED", { actor: "partner" }, {
      order_code: updated.code,
      from_fulfilment: result.previousFulfilment,
      to_fulfilment: input.fulfilment,
    }).catch(() => undefined);
  }
  return {
    ok: true,
    order: {
      code: updated.code,
      status: updated.merchantStatus as MerchantOrderStatus,
      statusUpdatedAt: updated.merchantStatusUpdatedAt.toISOString(),
      prepMinutes: updated.merchantPrepMinutes,
      rejectionReason: updated.merchantRejectionReason,
      fulfilment: updated.merchantFulfilment === "pickup" ? "pickup" : "delivery",
      addressText: updated.addressText,
    },
  };
}

/**
 * Cheap authoritative change signal for the paired Merchant App.
 *
 * Two small aggregates, both served by existing restaurant-leading indexes.
 * The event ledger's max id covers edits that leave every order timestamp
 * untouched (fulfilment switches, address corrections, reviews and replies).
 */
export async function getMerchantSyncVersion(restaurantId: number): Promise<MerchantSyncVersion> {
  const visible = and(
    eq(orders.restaurantId, restaurantId),
    eq(orders.merchantManaged, true),
    or(eq(orders.paymentMethod, "cod"), eq(orders.paymentStatus, "PAID")),
  );
  const [[orderRow], [eventRow]] = await Promise.all([
    db.select({
      count: sql<number>`count(*)::int`,
      paidCount: sql<number>`count(*) filter (where ${orders.paymentStatus} = 'PAID')::int`,
      latestCreated: sql<string | null>`max(${orders.createdAt})::text`,
      latestStatus: sql<string | null>`max(${orders.merchantStatusUpdatedAt})::text`,
      latestFeedback: sql<string | null>`max(${orders.feedbackAt})::text`,
      latestReply: sql<string | null>`max(${orders.merchantRespondedAt})::text`,
    }).from(orders).where(visible),
    db.select({ latestEvent: sql<string | null>`max(${merchantOrderEvents.id})::text` })
      .from(merchantOrderEvents).where(eq(merchantOrderEvents.restaurantId, restaurantId)),
  ]);
  const snapshot: MerchantSyncSnapshot = {
    count: Number(orderRow?.count ?? 0),
    paidCount: Number(orderRow?.paidCount ?? 0),
    latestCreated: orderRow?.latestCreated ?? null,
    latestStatus: orderRow?.latestStatus ?? null,
    latestEvent: eventRow?.latestEvent ?? null,
    latestFeedback: orderRow?.latestFeedback ?? null,
    latestReply: orderRow?.latestReply ?? null,
  };
  return merchantSyncVersion(snapshot);
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
      .from(orders).where(and(scope, inArray(orders.merchantStatus, ["COMPLETED", "DELIVERED"]), gte(orders.merchantStatusUpdatedAt, startOfDay))),
    db.select({ code: orders.code }).from(orders)
      .where(and(scope, eq(orders.merchantStatus, "PLACED")))
      .orderBy(desc(orders.createdAt)).limit(1),
  ]);
  const counts: Record<string, number> = { new: 0, accepted: 0, preparing: 0, ready: 0, out_for_delivery: 0, completed: 0, rejected: 0, cancelled: 0 };
  const map: Record<string, string> = { PLACED: "new", ACCEPTED: "accepted", PREPARING: "preparing", READY: "ready", OUT_FOR_DELIVERY: "out_for_delivery", COMPLETED: "completed", DELIVERED: "completed", REJECTED: "rejected", CANCELLED: "cancelled" };
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
    return { kind: "CANCELLED", idempotent: false, status: "CANCELLED", id: updated.id, restaurantId: updated.restaurantId, externalOrderId: updated.externalOrderId, orderCode: updated.code } as const;
  });
  if (result.kind === "CANCELLED" && !result.idempotent && "restaurantId" in result && result.externalOrderId) {
    await recordIntegrationAudit(result.restaurantId, "MERCHANT_ORDER_STATUS_UPDATED", { actor: "system" }, {
      order_code: result.orderCode, from_status: "PLACED_OR_ACCEPTED", to_status: "CANCELLED", reason: "CUSTOMER_REQUEST",
    }).catch(() => undefined);
    await handleCancelledOrderPayment(result.restaurantId, result.externalOrderId, "CUSTOMER_CANCELLED_ORDER").catch((error) => {
      console.error("[merchant-orders] customer cancellation payment settlement failed", error);
    });
    await recordOrderNotification({ orderId: result.id, kind: "order_status", detail: "CANCELLED" });
  }
  return result.kind === "CANCELLED"
    ? { kind: "CANCELLED", idempotent: result.idempotent, status: "CANCELLED" }
    : result;
}
