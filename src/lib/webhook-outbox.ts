import { db } from "@/db";
import {
  menuItems,
  orderItems,
  orders,
  restaurantIntegrations,
  restaurants,
  webhookEvents,
} from "@/db/schema";
import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { num } from "./format";
import { signWebhookPayload } from "./integrations";
import {
  API_KEY_HEADER,
  IDEMPOTENCY_HEADER, // PHASE 17
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  type OutboundOrderCancelEvent,
  type OutboundOrderEvent,
} from "./integration-contract";

export type OutboundEventType = "order.created" | "order.cancelled";

const OUTBOUND_ROUTE: Record<OutboundEventType, (reference: string) => string> = {
  "order.created": () => "/integration/orders",
  "order.cancelled": (reference) => `/integration/orders/${reference}/cancel`,
};

/**
 * PHASE 36 — outbound webhook delivery via the webhook_events outbox.
 *
 * Lifecycle: placeOrder/transitionOrder call enqueueOutboundEvent → a
 * `pending` row appears → dispatchPendingWebhooks POSTs it to the restaurant's
 * endpoint_url with the shared webhook secret signature and the RestaurantAI
 * contract headers. Delivery is a dispatch worker (a cron calls
 * dispatchPendingWebhooks); enqueue never sends, so a busier marketplace can
 * never lose an event to a slow restaurant.
 */

/**
 * PHASE 16 — Enqueue an outbound event and update the order's POS delivery
 * status. Returns `true` when the event was queued. When the restaurant is
 * not connected or has no endpoint, the order is marked "failed" so the admin
 * can see it immediately.
 */
export async function enqueueOutboundEvent(
  orderId: number,
  eventType: OutboundEventType,
): Promise<boolean> {
  const [integration] = await db
    .select()
    .from(restaurantIntegrations)
    .innerJoin(orders, eq(orders.id, orderId))
    .where(
      and(
        eq(restaurantIntegrations.restaurantId, orders.restaurantId),
        eq(restaurantIntegrations.status, "connected"),
      ),
    )
    .limit(1);

  const row = integration?.restaurant_integrations;
  if (!row || !row.endpointUrl) {
    // POS not connected — mark the order so the admin sees it.
    await db
      .update(orders)
      .set({
        posDeliveryStatus: "failed",
        posLastDeliveryError: "Restaurant POS is not connected",
      })
      .where(eq(orders.id, orderId));
    return false;
  }

  const payload = await buildOutboundPayload(orderId, eventType);
  if (!payload) return false;

  await db.insert(webhookEvents).values({
    restaurantId: row.restaurantId,
    integrationId: row.id,
    orderId,
    eventType,
    payload: JSON.stringify(payload),
    status: "pending",
  });

  await db
    .update(orders)
    .set({ posDeliveryStatus: "queued" })
    .where(eq(orders.id, orderId));

  return true;
}

async function buildOutboundPayload(
  orderId: number,
  eventType: OutboundEventType,
): Promise<OutboundOrderEvent | OutboundOrderCancelEvent | null> {
  const [orderRef] = await db
    .select({ reference: orders.reference })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!orderRef) return null;

  if (eventType === "order.cancelled") {
    return {
      event: "order.cancelled",
      external_order_id: orderRef.reference, // PHASE 17
      order: { reference: orderRef.reference, status: "cancelled" },
    } satisfies OutboundOrderCancelEvent;
  }

  const [orderArr, items, restaurantArr] = await Promise.all([
    db
      .select({
        id: orders.id,
        reference: orders.reference,
        status: orders.status,
        fulfillmentType: orders.fulfillmentType,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        subtotal: orders.subtotal,
        taxAmount: orders.taxAmount,
        discountAmount: orders.discountAmount,
        deliveryFee: orders.deliveryFee,
        total: orders.total,
        customerId: orders.customerId,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        customerAddress: orders.customerAddress,
        scheduledFor: orders.scheduledFor,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1),
    db
      .select({
        orderId: orderItems.orderId,
        menuItemId: orderItems.menuItemId,
        name: orderItems.name,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        modifiers: orderItems.modifiers,
        externalId: menuItems.externalId,
      })
      .from(orderItems)
      .leftJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
      .where(eq(orderItems.orderId, orderId)),
    db
      .select({
        marketplaceId: restaurants.marketplaceId,
        slug: restaurants.slug,
        name: restaurants.name,
      })
      .from(restaurants)
      .innerJoin(orders, eq(orders.restaurantId, restaurants.id))
      .where(eq(orders.id, orderId))
      .limit(1),
  ]);
  const order = orderArr[0];
  const restaurant = restaurantArr[0];

  if (!order) return null;
  return {
    event: "order.created",
    external_order_id: order.reference, // PHASE 17
    order: {
      reference: order.reference,
      status: order.status,
      fulfillment: order.fulfillmentType as "pickup" | "delivery",
      payment: {
        method: order.paymentMethod,
        status: order.paymentStatus,
        total: num(order.total),
      },
      customer: {
        name: order.customerName,
        address: order.customerAddress,
      },
      restaurant: {
        marketplaceId: restaurant?.marketplaceId ?? "",
        slug: restaurant?.slug ?? "",
        name: restaurant?.name ?? "",
      },
      items: items.map((i) => ({
        externalId: i.externalId ?? null,
        name: i.name,
        quantity: i.quantity,
        unitPrice: num(i.unitPrice),
        modifiers: parseModifiers(i.modifiers),
      })),
      totals: {
        subtotal: num(order.subtotal),
        tax: num(order.taxAmount),
        discount: num(order.discountAmount),
        deliveryFee: num(order.deliveryFee),
        total: num(order.total),
      },
      scheduledFor: order.scheduledFor?.toISOString() ?? null,
      placedAt: order.createdAt.toISOString(),
    },
  } satisfies OutboundOrderEvent;
}

function parseModifiers(raw: string): { name: string; priceDelta: number }[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
      .map((m) => ({
        name: String(m.name ?? ""),
        priceDelta: num(typeof m.priceDelta === "number" ? m.priceDelta : (m.priceDelta as string | number | null | undefined)),
      }));
  } catch {
    return [];
  }
}

export type DispatchResult = {
  attempted: number;
  delivered: number;
  failed: number;
};

/**
 * Deliver every pending/retrying outbox event that is due, in next-attempt
 * order. Returns counts. Safe to run concurrently: each row is claimed with a
 * conditional update on `status = 'pending'`.
 */
export async function dispatchPendingWebhooks(opts: { limit?: number } = {}): Promise<DispatchResult> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const now = new Date();

  const due = await db
    .select({
      event: webhookEvents,
      integration: restaurantIntegrations,
    })
    .from(webhookEvents)
    .innerJoin(
      restaurantIntegrations,
      eq(restaurantIntegrations.id, webhookEvents.integrationId),
    )
    .where(
      and(
        inArray(webhookEvents.status, ["pending", "retrying"]),
        sql`(${webhookEvents.nextAttemptAt} IS NULL OR ${webhookEvents.nextAttemptAt} <= ${now})`,
      ),
    )
    .orderBy(asc(webhookEvents.id))
    .limit(limit);

  let delivered = 0;
  let failed = 0;
  const result: DispatchResult = { attempted: due.length, delivered: 0, failed: 0 };

  for (const row of due) {
    const event = row.event;
    const integration = row.integration;

    const claimed = await db
      .update(webhookEvents)
      .set({ attempts: sql`${webhookEvents.attempts} + 1` })
      .where(
        and(
          eq(webhookEvents.id, event.id),
          inArray(webhookEvents.status, ["pending", "retrying"]),
        ),
      )
      .returning({ id: webhookEvents.id });
    if (claimed.length === 0) continue;
    result.attempted++;
    // PHASE 16 — mark the order as actively being delivered.
    if (event.orderId) {
      await db
        .update(orders)
        .set({ posDeliveryStatus: "delivering" })
        .where(eq(orders.id, event.orderId));
    }
    if (!integration.endpointUrl) {
      await markFailed(event.id, "Restaurant has no endpoint_url configured", new Date());
      failed++;
      continue;
    }

    const reference = parsedReference(event.eventType, event.payload);
    const route = OUTBOUND_ROUTE[event.eventType as OutboundEventType];
    if (!route || !reference) {
      await markFailed(event.id, `Unknown outbound event type "${event.eventType}"`, now);
      failed++;
      continue;
    }

    const url = new URL(
      route(reference).replace(/^\//, ""),
      integration.endpointUrl.replace(/\/+$/, "") + "/",
    ).toString();
    const timestamp = String(Date.now());
    const signature = signWebhookPayload(integration.webhookSecret, timestamp, event.payload);
    const apiKey = integration.apiKeyRaw; // PHASE 12 — server-side only.
    const idempotencyKey = idempotencyKeyFor(event.eventType, reference, event.payload); // PHASE 17

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [TIMESTAMP_HEADER]: timestamp,
          [IDEMPOTENCY_HEADER]: idempotencyKey,
          ...(apiKey ? { [API_KEY_HEADER]: apiKey } : {}),
        },
        body: event.payload,
      });
      if (res.ok) {
        await db
          .update(webhookEvents)
          .set({
            status: "success",
            deliveredAt: now,
            lastHttpStatus: res.status,
            lastError: "",
            nextAttemptAt: null,
          })
          .where(eq(webhookEvents.id, event.id));
        // PHASE 16 — reflect successful POS delivery on the order.
        if (event.orderId) {
          await db
            .update(orders)
            .set({
              posDeliveryStatus: "delivered",
              posDeliveredAt: now,
              posLastDeliveryError: "",
            })
            .where(eq(orders.id, event.orderId));
        }
        delivered++;
      } else {
        const text = await res.text().catch(() => "");
        await requeue(event.id, res.status, text.slice(0, 500), now);
        failed++;
      }
    } catch (e) {
      await requeue(event.id, 0, e instanceof Error ? e.message : String(e), now);
      failed++;
    }
  }

  result.delivered = delivered;
  result.failed = failed;
  return result;
}

async function requeue(
  id: number,
  status: number,
  error: string,
  now: Date,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({
      lastHttpStatus: status || null,
      lastError: error,
    })
    .where(eq(webhookEvents.id, id));

  const [row] = await db
    .select({ attempts: webhookEvents.attempts, maxAttempts: webhookEvents.maxAttempts, orderId: webhookEvents.orderId })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .limit(1);
  if (!row) return;
  if (row.attempts >= row.maxAttempts) {
    await markFailed(id, "Max attempts exhausted", now);
    // PHASE 16 — permanently failed: reflect on the order.
    if (row.orderId) {
      await db
        .update(orders)
        .set({
          posDeliveryStatus: "failed",
          posDeliveryAttempts: row.attempts,
          posLastDeliveryError: error || "Max attempts exhausted",
        })
        .where(eq(orders.id, row.orderId));
    }
  } else {
    const backoff =
      Math.min(30, Math.pow(2, row.attempts)) * 1000;
    await db
      .update(webhookEvents)
      .set({ status: "retrying", nextAttemptAt: new Date(now.getTime() + backoff) })
      .where(eq(webhookEvents.id, id));
    // PHASE 16 — retry in progress: keep order in "queued" with updated attempts.
    if (row.orderId) {
      await db
        .update(orders)
        .set({
          posDeliveryStatus: "queued",
          posDeliveryAttempts: row.attempts,
          posLastDeliveryError: error,
        })
        .where(eq(orders.id, row.orderId));
    }
  }
}

async function markFailed(id: number, error: string, now: Date): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: "failed", lastError: error, nextAttemptAt: null })
    .where(eq(webhookEvents.id, id));

  // PHASE 16 — terminal failure: reflect on the linked order.
  const [row] = await db
    .select({ orderId: webhookEvents.orderId })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .limit(1);
  if (row?.orderId) {
    await db
      .update(orders)
      .set({
        posDeliveryStatus: "failed",
        posLastDeliveryError: error,
      })
      .where(eq(orders.id, row.orderId));
  }
}

function parsedReference(eventType: string, payload: string): string | null {
  try {
    const parsed = JSON.parse(payload) as { order?: { reference?: string } };
    if (parsed && typeof parsed.order?.reference === "string") {
      return parsed.order.reference;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/**
 * PHASE 17 — stable idempotency key for a payload. For order events it IS the
 * external_order_id (dedup source of truth). Scoped by event type so a retried
 * `order.created` and a retried `order.cancelled` for the same order do not
 * collide (creation and cancellation are both idempotent but distinct).
 */
function idempotencyKeyFor(
  eventType: string,
  reference: string,
  payload: string,
): string {
  try {
    const parsed = JSON.parse(payload) as { external_order_id?: string };
    if (typeof parsed.external_order_id === "string" && parsed.external_order_id) {
      return `${eventType}:${parsed.external_order_id}`;
    }
  } catch {
    /* fallthrough */
  }
  return `${eventType}:${reference}`;
}