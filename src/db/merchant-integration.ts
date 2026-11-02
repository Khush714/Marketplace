import "server-only";

import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  marketplaceOrderEvents,
  menuItems,
  orderItemLineTotalCents,
  orders,
  restaurants,
  type OrderItemSnapshot,
} from "@/db/schema";
import { canTransition, isMarketplaceOrderStatus } from "@/integrations/pos/order-status";
import { isClearedForPos } from "@/integrations/pos/order-payload-shape";
import { DEFAULT_DISH_IMAGE, sanitizeImageUrl } from "@/lib/domain";
import {
  canTransitionMerchantDelivery,
  isMerchantDeliveryMode,
  isMerchantDeliveryStatus,
  type MerchantDeliveryMode,
  type MerchantDeliveryStatus,
} from "@/lib/merchant-delivery-core";
import { recordIntegrationAudit } from "@/db/queries";

export type MerchantMenuItemInput = {
  name: string;
  description: string;
  category: string;
  price: number;
  imageUrl: string;
  dietary: "veg" | "nonveg" | "unspecified";
};

function merchantMenuItem(
  row: typeof menuItems.$inferSelect,
  merchantBusinessId: string,
) {
  return {
    id: String(row.id),
    businessId: merchantBusinessId,
    name: row.name,
    description: row.description,
    price: row.priceCents,
    category: row.category,
    imageUrl: sanitizeImageUrl(row.imageUrl, DEFAULT_DISH_IMAGE),
    dietary: row.isVeg ? "veg" : "nonveg",
    available: row.available,
    archived: false,
  };
}

export async function listMerchantMenuItems(restaurantId: number, businessId: string) {
  const rows = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.restaurantId, restaurantId))
    .orderBy(asc(menuItems.category), asc(menuItems.name))
    .limit(500);
  return rows.map((row) => merchantMenuItem(row, businessId));
}

export async function createMerchantMenuItem(
  restaurantId: number,
  businessId: string,
  input: MerchantMenuItemInput,
) {
  const [row] = await db
    .insert(menuItems)
    .values({
      restaurantId,
      category: input.category,
      name: input.name,
      description: input.description,
      priceCents: input.price,
      imageUrl: sanitizeImageUrl(input.imageUrl, DEFAULT_DISH_IMAGE),
      isVeg: input.dietary === "veg",
      available: true,
    })
    .returning();
  return row ? merchantMenuItem(row, businessId) : null;
}

export async function updateMerchantMenuItem(
  restaurantId: number,
  businessId: string,
  itemId: number,
  changes: Partial<MerchantMenuItemInput> | { available: boolean },
) {
  const values =
    "available" in changes
      ? { available: changes.available }
      : {
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.description !== undefined ? { description: changes.description } : {}),
          ...(changes.category !== undefined ? { category: changes.category } : {}),
          ...(changes.price !== undefined ? { priceCents: changes.price } : {}),
          ...(changes.imageUrl !== undefined
            ? { imageUrl: sanitizeImageUrl(changes.imageUrl, DEFAULT_DISH_IMAGE) }
            : {}),
          ...(changes.dietary !== undefined ? { isVeg: changes.dietary === "veg" } : {}),
        };
  const [row] = await db
    .update(menuItems)
    .set(values)
    .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
    .returning();
  return row ? merchantMenuItem(row, businessId) : null;
}

export async function deleteMerchantMenuItem(restaurantId: number, itemId: number): Promise<boolean> {
  const [row] = await db
    .delete(menuItems)
    .where(and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)))
    .returning({ id: menuItems.id });
  return row !== undefined;
}

export async function updateMerchantRestaurant(
  restaurantId: number,
  changes: Partial<{
    name: string;
    isActive: boolean;
    merchantPickupEnabled: boolean;
    merchantDeliveryEnabled: boolean;
    merchantHoursEnabled: boolean;
    merchantOpensAt: string;
    merchantClosesAt: string;
  }>,
) {
  const [restaurant] = await db
    .update(restaurants)
    .set(changes)
    .where(eq(restaurants.id, restaurantId))
    .returning();
  return restaurant ?? null;
}

export async function getMerchantRestaurantSettings(restaurantId: number) {
  const [restaurant] = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
      isActive: restaurants.isActive,
      merchantPickupEnabled: restaurants.merchantPickupEnabled,
      merchantDeliveryEnabled: restaurants.merchantDeliveryEnabled,
      merchantHoursEnabled: restaurants.merchantHoursEnabled,
      merchantOpensAt: restaurants.merchantOpensAt,
      merchantClosesAt: restaurants.merchantClosesAt,
    })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return restaurant ?? null;
}

export type MerchantOrderFilters = {
  status: string;
  search: string;
  from: string | null;
  to: string | null;
  page: number;
  limit: number;
};

function dateBound(raw: string | null, endOfDay: boolean): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }
  const start = new Date(`${raw}T00:00:00+05:30`);
  if (!Number.isFinite(start.getTime())) return null;
  return endOfDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : start;
}

export async function listMerchantOrders(restaurantId: number, filters: MerchantOrderFilters) {
  const where = [eq(orders.restaurantId, restaurantId), eq(orders.merchantFulfillment, true)];

  if (filters.status === "active") {
    where.push(
      inArray(orders.integrationStatus, [
        "PLACED",
        "ACCEPTED",
        "PREPARING",
        "READY",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
      ]),
    );
  } else if (filters.status === "cancelled") {
    where.push(inArray(orders.integrationStatus, ["CANCELLED", "REJECTED"]));
  } else if (filters.status !== "all") {
    const status = filters.status === "new" ? "PLACED" : filters.status.toUpperCase();
    if (!isMarketplaceOrderStatus(status)) return { rows: [], hasMore: false };
    where.push(eq(orders.integrationStatus, status));
  }

  if (filters.search) {
    where.push(ilike(orders.code, `%${filters.search}%`));
  }
  const from = dateBound(filters.from, false);
  const to = dateBound(filters.to, true);
  if (from) where.push(gte(orders.createdAt, from));
  if (to) where.push(lt(orders.createdAt, to));

  if (filters.status === "active" || filters.status === "new") {
    where.push(
      or(
        eq(orders.paymentMethod, "cod"),
        inArray(orders.paymentStatus, ["PAID", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"]),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(orders)
    .where(and(...where))
    .orderBy(desc(orders.createdAt))
    .limit(filters.limit + 1)
    .offset((filters.page - 1) * filters.limit);
  return { rows: rows.slice(0, filters.limit), hasMore: rows.length > filters.limit };
}

export function toMerchantOrder(row: typeof orders.$inferSelect, businessId: string) {
  const items = (row.items as OrderItemSnapshot[]).map((item, index) => ({
    id: `${row.code}-${index}`,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.priceCents,
    lineTotal: orderItemLineTotalCents(item),
    modifiers: (item.modifiers ?? []).map((modifier) => ({
      name: modifier.name,
      quantity: modifier.quantity,
      priceCents: modifier.priceCents,
    })),
  }));
  return {
    code: row.code,
    customerName: row.customerName,
    instructions: row.instructions,
    totalCents: row.totalCents,
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    status: row.integrationStatus,
    fulfilment: "delivery",
    addressText: row.addressText,
    deliveryFeeCents: row.deliveryFeeCents,
    platformFeeCents: row.platformFeeCents,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    prepMinutes: row.merchantPrepMinutes,
    rejectionReason: row.merchantRejectionReason,
    deliveryMode: row.merchantDeliveryMode,
    deliveryStatus: row.merchantDeliveryStatus,
    courierName: row.merchantCourierName,
    deliveryUpdatedAt: row.merchantDeliveryUpdatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    statusUpdatedAt: row.statusUpdatedAt?.toISOString() ?? null,
    items,
    businessId,
  };
}

export async function updateMerchantOrderDeliveryMode(input: {
  restaurantId: number;
  orderCode: string;
  deliveryMode: MerchantDeliveryMode | null;
}) {
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, input.restaurantId),
        eq(orders.code, input.orderCode),
        eq(orders.merchantFulfillment, true),
      ),
    )
    .limit(1);
  if (!order) return { kind: "not_found" } as const;
  if (
    ["COMPLETED", "CANCELLED", "REJECTED"].includes(order.integrationStatus) ||
    order.merchantDeliveryStatus !== "pending"
  ) {
    return { kind: "not_editable" } as const;
  }

  const [updated] = await db
    .update(orders)
    .set({ merchantDeliveryMode: input.deliveryMode })
    .where(
      and(
        eq(orders.id, order.id),
        eq(orders.restaurantId, input.restaurantId),
        eq(orders.merchantFulfillment, true),
        eq(orders.merchantDeliveryStatus, "pending"),
        inArray(orders.integrationStatus, ["PLACED", "ACCEPTED", "PREPARING", "READY"]),
      ),
    )
    .returning();
  if (updated) {
    await recordIntegrationAudit(
      input.restaurantId,
      "MERCHANT_DELIVERY_MODE_UPDATED",
      { actor: "merchant" },
      { order_code: input.orderCode, delivery_mode: input.deliveryMode },
    );
  }
  return updated ? { kind: "updated", order: updated } as const : { kind: "conflict" } as const;
}

export async function updateMerchantOrderDelivery(input: {
  restaurantId: number;
  businessId: string;
  orderCode: string;
  status: MerchantDeliveryStatus;
  courierName?: string;
}) {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, input.restaurantId),
          eq(orders.code, input.orderCode),
          eq(orders.merchantFulfillment, true),
        ),
      )
      .for("update")
      .limit(1);
    if (!order) return { kind: "not_found" } as const;
    if (!isMerchantDeliveryMode(order.merchantDeliveryMode)) {
      return { kind: "delivery_mode_required" } as const;
    }
    if (!isMerchantDeliveryStatus(order.merchantDeliveryStatus)) {
      return { kind: "conflict" } as const;
    }

    if (order.merchantDeliveryStatus === input.status && input.status !== "assigned") {
      return { kind: "duplicate", order } as const;
    }
    if (!canTransitionMerchantDelivery(order.merchantDeliveryStatus, input.status)) {
      return { kind: "invalid_transition" } as const;
    }
    if (!["ACCEPTED", "PREPARING", "READY"].includes(order.integrationStatus)) {
      return { kind: "not_ready" } as const;
    }
    if (
      (input.status === "picked_up" || input.status === "delivered") &&
      order.integrationStatus !== "READY"
    ) {
      return { kind: "not_ready" } as const;
    }

    const courierName = input.courierName ?? order.merchantCourierName;
    if (input.status !== "pending" && !courierName) {
      return { kind: "courier_required" } as const;
    }

    const now = new Date();
    const eventId = `merchant:${input.businessId}:${input.orderCode}:delivery:${input.status}`;
    if (order.merchantDeliveryStatus !== input.status) {
      const [event] = await tx
        .insert(marketplaceOrderEvents)
        .values({
          restaurantId: input.restaurantId,
          eventId,
          externalOrderId: order.externalOrderId ?? `merchant_${order.code}`,
          posOrderId: order.posOrderId ?? null,
          status: `DELIVERY_${input.status.toUpperCase()}`,
        })
        .onConflictDoNothing({ target: marketplaceOrderEvents.eventId })
        .returning({ id: marketplaceOrderEvents.id });
      if (!event) return { kind: "conflict" } as const;

      if (input.status === "delivered") {
        const [completionEvent] = await tx
          .insert(marketplaceOrderEvents)
          .values({
            restaurantId: input.restaurantId,
            eventId: `merchant:${input.businessId}:${input.orderCode}:COMPLETED`,
            externalOrderId: order.externalOrderId ?? `merchant_${order.code}`,
            posOrderId: order.posOrderId ?? null,
            status: "COMPLETED",
          })
          .onConflictDoNothing({ target: marketplaceOrderEvents.eventId })
          .returning({ id: marketplaceOrderEvents.id });
        if (!completionEvent) return { kind: "conflict" } as const;
      }
    }

    const [updated] = await tx
      .update(orders)
      .set({
        merchantDeliveryStatus: input.status,
        merchantCourierName: courierName,
        merchantDeliveryUpdatedAt: now,
        ...(input.status === "delivered"
          ? { integrationStatus: "COMPLETED", statusUpdatedAt: now }
          : {}),
      })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.restaurantId, input.restaurantId),
          eq(orders.merchantFulfillment, true),
          eq(orders.merchantDeliveryStatus, order.merchantDeliveryStatus),
          eq(orders.integrationStatus, order.integrationStatus),
        ),
      )
      .returning();
    return updated ? { kind: "updated", order: updated, eventId } as const : { kind: "conflict" } as const;
  });

  if (result.kind === "updated") {
    await recordIntegrationAudit(
      input.restaurantId,
      "MERCHANT_DELIVERY_UPDATED",
      { actor: "merchant" },
      {
        event_id: result.eventId,
        order_code: input.orderCode,
        delivery_status: input.status,
        courier_assigned: Boolean(result.order.merchantCourierName),
      },
    );
    return { kind: "updated", order: result.order } as const;
  }
  return result;
}

export type MerchantOrderTransitionResult =
  | { kind: "updated"; order: typeof orders.$inferSelect }
  | { kind: "duplicate"; order: typeof orders.$inferSelect }
  | { kind: "not_found" }
  | { kind: "conflict"; currentStatus: string }
  | { kind: "invalid_transition" }
  | { kind: "delivery_mode_required" }
  | { kind: "delivery_not_complete" }
  | { kind: "payment_not_cleared" };

const MERCHANT_TRANSITIONS: Record<string, readonly string[]> = {
  PLACED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["PREPARING"],
  PREPARING: ["READY"],
  READY: ["COMPLETED"],
};

export async function transitionMerchantOrder(input: {
  restaurantId: number;
  businessId: string;
  orderCode: string;
  expectedStatus: string;
  nextStatus: string;
  prepMinutes?: number;
  reason?: string;
}): Promise<MerchantOrderTransitionResult> {
  if (
    !isMarketplaceOrderStatus(input.expectedStatus) ||
    !isMarketplaceOrderStatus(input.nextStatus) ||
    !MERCHANT_TRANSITIONS[input.expectedStatus]?.includes(input.nextStatus) ||
    !canTransition(input.expectedStatus, input.nextStatus)
  ) {
    return { kind: "invalid_transition" };
  }
  const eventId = `merchant:${input.businessId}:${input.orderCode}:${input.nextStatus}`;

  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.restaurantId, input.restaurantId), eq(orders.code, input.orderCode)))
      .for("update")
      .limit(1);
    if (!order || !order.merchantFulfillment) return { kind: "not_found" } as const;

    const [existingEvent] = await tx
      .select({ id: marketplaceOrderEvents.id })
      .from(marketplaceOrderEvents)
      .where(eq(marketplaceOrderEvents.eventId, eventId))
      .limit(1);
    if (existingEvent && order.integrationStatus === input.nextStatus) {
      return { kind: "duplicate", order } as const;
    }
    if (order.integrationStatus !== input.expectedStatus) {
      return { kind: "conflict", currentStatus: order.integrationStatus } as const;
    }
    if (input.nextStatus === "COMPLETED" && !isMerchantDeliveryMode(order.merchantDeliveryMode)) {
      return { kind: "delivery_mode_required" } as const;
    }
    if (input.nextStatus === "COMPLETED" && order.merchantDeliveryStatus !== "delivered") {
      return { kind: "delivery_not_complete" } as const;
    }
    if (input.nextStatus === "ACCEPTED" && !isClearedForPos(order)) {
      return { kind: "payment_not_cleared" } as const;
    }

    const [event] = await tx
      .insert(marketplaceOrderEvents)
      .values({
        restaurantId: input.restaurantId,
        eventId,
        externalOrderId: order.externalOrderId ?? `merchant_${order.code}`,
        posOrderId: order.posOrderId ?? null,
        status: input.nextStatus,
      })
      .onConflictDoNothing({ target: marketplaceOrderEvents.eventId })
      .returning({ id: marketplaceOrderEvents.id });
    if (!event) return { kind: "conflict", currentStatus: order.integrationStatus } as const;

    const [updated] = await tx
      .update(orders)
      .set({
        integrationStatus: input.nextStatus,
        statusUpdatedAt: new Date(),
        ...(input.nextStatus === "ACCEPTED" ? { merchantPrepMinutes: input.prepMinutes } : {}),
        ...(input.nextStatus === "REJECTED" ? { merchantRejectionReason: input.reason ?? "" } : {}),
      })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.restaurantId, input.restaurantId),
          eq(orders.integrationStatus, input.expectedStatus),
        ),
      )
      .returning();
    if (!updated) return { kind: "conflict", currentStatus: order.integrationStatus } as const;
    return { kind: "updated", order: updated } as const;
  });

  if (result.kind === "updated") {
    await recordIntegrationAudit(
      input.restaurantId,
      "ORDER_STATUS_UPDATED",
      { actor: "merchant" },
      {
        event_id: eventId,
        external_order_id: result.order.externalOrderId,
        status: input.nextStatus,
        reason: input.nextStatus === "REJECTED" ? input.reason : undefined,
      },
    );
  }
  return result;
}

export async function getMerchantOverview(restaurantId: number) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const start = new Date(`${date}T00:00:00+05:30`);

  const [groups, [today], [completed], [latestNew]] = await Promise.all([
    db
      .select({ status: orders.integrationStatus, count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.merchantFulfillment, true)))
      .groupBy(orders.integrationStatus),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.merchantFulfillment, true), gte(orders.createdAt, start))),
    db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${orders.totalCents}), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.merchantFulfillment, true),
          eq(orders.integrationStatus, "COMPLETED"),
          gte(orders.statusUpdatedAt, start),
        ),
      ),
    db
      .select({ code: orders.code })
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.merchantFulfillment, true), eq(orders.integrationStatus, "PLACED")))
      .orderBy(desc(orders.createdAt))
      .limit(1),
  ]);
  const counts: Record<string, number> = {
    new: 0,
    accepted: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
  };
  const statusToMerchant: Record<string, string> = {
    PLACED: "new",
    ACCEPTED: "accepted",
    PREPARING: "preparing",
    READY: "ready",
    OUT_FOR_DELIVERY: "ready",
    DELIVERED: "completed",
    COMPLETED: "completed",
    REJECTED: "rejected",
    CANCELLED: "cancelled",
  };
  groups.forEach((group) => {
    const status = statusToMerchant[group.status];
    if (status) counts[status] += group.count;
  });

  return {
    counts,
    todaySales: completed.total,
    todayOrders: today.count,
    completedToday: completed.count,
    latestNewOrderId: latestNew?.code ?? null,
    settlements: [],
  };
}
