import { db } from "@/db";
import { menuItems, orders, restaurantIntegrations, webhookEvents } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { transitionOrder } from "./order-actions";
import { findItemByExternalId } from "./external-map";
import type {
  InboundWebhookBody,
  InboundWebhookResponse,
} from "./integration-contract";

/**
 * PHASE 13 — unified inbound webhook processor.
 *
 * Verify → Identify → Validate → Dedup → Record → Process → Ack.
 * Called by POST /api/integrations/webhooks/restaurantai after signature
 * verification. Returns the ack payload; the route sends it.
 */
export async function processInboundWebhook(
  body: InboundWebhookBody,
  restaurantId: number,
): Promise<InboundWebhookResponse> {
  // ── Validate ────────────────────────────────────────────────────────────
  const eventType = body.event;
  if (!eventType) {
    return { ok: false, error: "event is required" };
  }

  const eventId = (body.event_id ?? "").trim();
  if (!eventId) {
    return { ok: false, error: "event_id is required for idempotent delivery" };
  }

  const restaurantIdStr = (body.restaurant_id ?? "").trim();
  if (!restaurantIdStr) {
    return { ok: false, error: "restaurant_id is required" };
  }

  // ── Dedup ───────────────────────────────────────────────────────────────
  const [existing] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(eq(webhookEvents.eventId, eventId))
    .limit(1);
  if (existing) {
    return { ok: true, eventId, processed: false };
  }

  // ── Record ──────────────────────────────────────────────────────────────
  // PHASE 18 — order resolution is SCOPED to the signing restaurant. A signed
  // webhook can only ever resolve (and later transition) orders it owns.
  const orderIdStr = (body.order_id ?? "").trim();
  let orderId: number | null = null;
  let resolvedReference: string | null = null;
  if (orderIdStr) {
    const [order] = await db
      .select({ id: orders.id, reference: orders.reference })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          or(
            orderIdStr.match(/^\d+$/)
              ? eq(orders.id, Number(orderIdStr))
              : eq(orders.reference, orderIdStr),
            eq(orders.externalOrderId, orderIdStr),
          ),
        ),
      )
      .limit(1);
    orderId = order?.id ?? null;
    resolvedReference = order?.reference ?? null;

    // PHASE 19 — capture the POS's own order id on the marketplace record so
    // future webhooks can be keyed by either identity.
    if (order && body.externalOrderId && body.externalOrderId !== order.reference) {
      await db
        .update(orders)
        .set({ externalOrderId: body.externalOrderId })
        .where(eq(orders.id, order.id));
    }
  }

  const [integration] = await db
    .select({ id: restaurantIntegrations.id })
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, restaurantId))
    .limit(1);

  await db.insert(webhookEvents).values({
    restaurantId,
    integrationId: integration?.id ?? null,
    orderId,
    eventType,
    eventId,
    direction: "inbound",
    payload: JSON.stringify(body),
    status: "received",
  });

  // ── Process ─────────────────────────────────────────────────────────────
  let processed = false;
  switch (eventType) {
    case "order.status_changed": {
      if (!body.status || !resolvedReference) break;
      const result = await transitionOrder(resolvedReference, body.status, {
        actor: "pos",
        restaurantId, // PHASE 18 — tenant guard at the single writer.
        note: body.data?.note
          ? String(body.data.note)
          : `Status updated via RestaurantAI webhook (${body.event_id})`,
      });
      processed = result.ok;
      break;
    }
    case "order.cancelled": {
      if (!resolvedReference) break;
      const result = await transitionOrder(resolvedReference, "cancelled", {
        actor: "pos",
        restaurantId, // PHASE 18 — tenant guard at the single writer.
        note: body.data?.reason
          ? String(body.data.reason)
          : `Cancelled via RestaurantAI webhook (${body.event_id})`,
      });
      processed = result.ok;
      break;
    }
    case "item.availability_changed": {
      const items = body.data?.items;
      if (!Array.isArray(items)) break;
      let count = 0;
      for (const item of items) {
        if (!item.externalId || typeof item.available !== "boolean") continue;
        const row = await findItemByExternalId(restaurantId, item.externalId);
        if (!row) continue;
        await db
          .update(menuItems)
          .set({ isAvailable: item.available })
          .where(eq(menuItems.id, row.id));
        count++;
      }
      processed = count > 0;
      break;
    }
    case "menu.updated": {
      const now = new Date();
      await db
        .update(restaurantIntegrations)
        .set({ lastSyncAt: now, lastSuccessAt: now, healthStatus: "healthy" })
        .where(eq(restaurantIntegrations.restaurantId, restaurantId));
      processed = true;
      break;
    }
    case "health.ping": {
      const now = new Date();
      await db
        .update(restaurantIntegrations)
        .set({ healthStatus: "healthy", lastSuccessAt: now })
        .where(eq(restaurantIntegrations.restaurantId, restaurantId));
      processed = true;
      break;
    }
  }

  // Mark as processed.
  if (processed) {
    await db
      .update(webhookEvents)
      .set({ status: "processed", updatedAt: new Date() })
      .where(eq(webhookEvents.eventId, eventId));
  }

  return { ok: true, eventId, processed };
}
