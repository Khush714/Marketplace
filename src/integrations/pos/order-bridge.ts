import "server-only";
import {
  claimPosDeliveryAttempt,
  enqueueOrderDelivery,
  externalOrderIdFor,
  getDuePosDeliveryIds,
  loadPosDeliveryContext,
  recordPosDeliveryFailure,
  recordPosDeliverySuccess,
  type PosDeliveryContext,
} from "@/db/pos-delivery";
import { orderItemLineTotalCents, type OrderRow } from "@/db/schema";
import { openWebhookSecret } from "@/lib/webhook-crypto";
import { postPosOrderIngest, PosOrderDeliveryError } from "@/integrations/pos/client";
import { isOnlinePaymentMethod, posItemName } from "@/integrations/pos/order-payload-shape";
import { integrationReadiness } from "@/integrations/pos/readiness";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Flat Marketplace → POS order payload. Everything rides stable ids:
 * `order.id` is the `mkt_ord_<id>` external order id (idempotency key on the
 * POS) and every line rides `marketplace_item_id` = String(menu_items.id) —
 * the same id the POS already stores in `marketplace_item_mappings` from
 * menu sync/entity events, so no name matching ever happens.
 */
export function buildPosOrderPayload(
  order: OrderRow,
  marketplaceId: string,
  hints?: { outletId?: string | null; branchId?: string | null },
): Record<string, unknown> {
  const items = order.items.map((it) => {
    const qty = Math.max(1, Math.floor(it.quantity) || 1);
    const lineTotalCents = orderItemLineTotalCents(it);
    // `unit_price` is the effective all-in per-unit amount, so the POS's own
    // unit_price × quantity reproduces exactly the line total the Marketplace
    // billed — the base price plus its modifiers — with no money drift on either
    // side. The base price and the modifier split are NOT sent: the POS discards
    // them on ingest, and the name above is where the modifier detail has to
    // live for it to survive at all.
    return {
      marketplace_item_id: String(it.menuItemId),
      name: posItemName(it),
      quantity: qty,
      unit_price: round2(lineTotalCents / qty / 100),
    };
  });

  const paidOnline = isOnlinePaymentMethod(order.paymentMethod);

  return {
    event: "order.created",
    order: {
      id: externalOrderIdFor(order.id),
      restaurant_id: marketplaceId,
      items,
      customer: { name: order.customerName, phone: order.phone },
      delivery_address: { address: order.addressText, instructions: order.instructions },
      subtotal: round2(order.subtotalCents / 100),
      delivery_fee: round2(order.deliveryFeeCents / 100),
      total: round2(order.totalCents / 100),
      order_type: "delivery",
      // PAID → POS records amount_paid = total, balance_due = 0
      // COD  → POS records amount_paid = 0,   balance_due = total
      payment_status: paidOnline ? "PAID" : "COD",
      // Phase 7 — branch/outlet routing hints. Only present feature-flagged with
      // the ACTIVE record's own values; a legacy integration (no outlet) omits
      // them so the POS keeps resolving the restaurant-level row. The POS
      // enforces the exact outlet match fail-closed (RESTAURANT_MISMATCH).
      ...(hints?.outletId ? { outlet_id: hints.outletId } : {}),
      ...(hints?.branchId ? { branch_id: hints.branchId } : {}),
    },
    timestamp: new Date().toISOString(),
  };
}

/* --------------------------- enqueue + drain ---------------------------- */

/**
 * Enqueue a created order for POS delivery (never blocks the checkout
 * response). Journal insert is synchronous DB work; the actual HTTP attempt
 * runs detached. Skips silently for restaurants without an ACTIVE integration.
 */
export async function enqueuePosDelivery(orderId: number): Promise<void> {
  let deliveryId: number | null = null;
  try {
    deliveryId = await enqueueOrderDelivery(orderId);
  } catch (e) {
    console.error("[pos-delivery] enqueue failed", e);
    return;
  }
  if (deliveryId == null) return;

  // The first attempt is AWAITED, not detached.
  //
  // This used to be `void attemptPosDelivery(...)`, which is fine on a long-lived
  // Node process but silently fatal on serverless. Vercel freezes or terminates
  // the instance as soon as the response is flushed, so the unawaited POST was
  // killed mid-flight and the row stayed PENDING — the customer saw a placed
  // order that the restaurant never received. The retry loop could not save it
  // either: the drain is an `unref()`'d setInterval in instrumentation.ts, and
  // an interval only runs in a process that is still resident, which a serverless
  // instance is not. Reproduced live: a production order sat PENDING with a null
  // pos_order_id indefinitely.
  //
  // Awaiting keeps the attempt inside the request lifetime. Durability is
  // unaffected — the row is already journaled above, so a POS outage or a
  // timeout still leaves a PENDING row for the cron drain to retry, and the
  // customer is never told "placed" before the restaurant has the order.
  try {
    await attemptPosDelivery(deliveryId);
  } catch (e) {
    // Never fail the checkout over delivery: the journal row is the retry.
    console.error("[pos-delivery] first attempt threw; leaving row for retry", e);
  }
}

export type DeliveryAttemptOutcome =
  | "delivered"
  | "terminal_failed"
  | "retry_scheduled"
  | "skipped"
  | "errored";

/**
 * Same rule as the payment bridge and `hasActiveIntegration`, delegated so the
 * three cannot drift — the wording is the operator-facing form of each reason.
 */
function notReadyReason(ctx: PosDeliveryContext): string | null {
  const { notReadyReason: reason } = integrationReadiness({
    status: ctx.marketplaceId && ctx.integrationActive ? "active" : "pending",
    posRestaurantId: ctx.marketplaceId,
    webhookSecret: ctx.sealedSecret,
  });
  if (!reason) return null;
  if (reason === "inactive") return ctx.marketplaceId ? "integration not active" : "integration not claimed";
  return "webhook secret missing";
}

/** Deliver one journaled order to the POS (claim → build → POST → outcome). */
export async function attemptPosDelivery(deliveryId: number): Promise<DeliveryAttemptOutcome> {
  const ctx = await loadPosDeliveryContext(deliveryId);
  if (!ctx) return "skipped";

  const claimed = await claimPosDeliveryAttempt(deliveryId);
  if (!claimed) return "skipped"; // another drain won this attempt slot

  const notReady = notReadyReason(ctx);
  if (notReady) {
    const terminal = await recordPosDeliveryFailure(
      deliveryId,
      notReady,
      true, // reactivation becomes retryable once the POS connects
      ctx.order.id,
      claimed.attempts,
    );
    return terminal ? "terminal_failed" : "retry_scheduled";
  }

  let secret: string;
  try {
    secret = openWebhookSecret(ctx.sealedSecret!);
  } catch {
    const terminal = await recordPosDeliveryFailure(
      deliveryId,
      "sealed webhook secret could not be opened",
      true,
      ctx.order.id,
      claimed.attempts,
    );
    return terminal ? "terminal_failed" : "retry_scheduled";
  }

  try {
    const payload = buildPosOrderPayload(ctx.order, ctx.marketplaceId!, {
      outletId: ctx.posOutletId,
      branchId: ctx.posBranchId,
    });
    const got = await postPosOrderIngest({ marketplaceId: ctx.marketplaceId!, secret, payload });
    await recordPosDeliverySuccess(deliveryId, got.response.pos_order_id, ctx.order.id, {
      branchId: ctx.posBranchId,
      outletId: ctx.posOutletId,
    });
    return "delivered";
  } catch (e) {
    const err = e instanceof PosOrderDeliveryError ? e : null;
    const retryable = err ? err.retryable : true;
    const terminal = await recordPosDeliveryFailure(
      deliveryId,
      (err ? err.message : String(e)).slice(0, 2000),
      retryable,
      ctx.order.id,
      claimed.attempts,
    );
    return terminal ? "terminal_failed" : "retry_scheduled";
  }
}

export interface PosDeliveryDrainSummary {
  processed: number;
  delivered: number;
  retryScheduled: number;
  terminalFailed: number;
  skipped: number;
  errored: number;
}

/**
 * The delivery worker: drain every due PENDING journal row, exactly-once per
 * row per pass (SKIP LOCKED + atomic attempt claim). Called by the
 * instrumentation drain loop, the ops endpoint, and right after enqueue.
 */
export async function processPendingPosDeliveries(limit = 20): Promise<PosDeliveryDrainSummary> {
  const ids = await getDuePosDeliveryIds(limit);
  const summary: PosDeliveryDrainSummary = {
    processed: ids.length,
    delivered: 0,
    retryScheduled: 0,
    terminalFailed: 0,
    skipped: 0,
    errored: 0,
  };
  for (const id of ids) {
    try {
      const outcome = await attemptPosDelivery(id);
      if (outcome === "delivered") summary.delivered++;
      else if (outcome === "retry_scheduled") summary.retryScheduled++;
      else if (outcome === "terminal_failed") summary.terminalFailed++;
      else if (outcome === "skipped") summary.skipped++;
      else summary.errored++;
    } catch (e) {
      summary.errored++;
      console.error(`[pos-delivery] unexpected error draining #${id}`, e);
    }
  }
  return summary;
}