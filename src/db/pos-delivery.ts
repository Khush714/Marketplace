import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { recordIntegrationAudit } from "@/db/queries";
import {
  integrationRecords,
  marketplaceOrderEvents,
  orders,
  posOrderDeliveries,
  restaurants,
  type OrderRow,
  type PosOrderDeliveryRow,
} from "@/db/schema";
import {
  canTransition,
  isAbsorbedAccepted,
  mapPosStatusToMarketplaceStatus,
} from "@/integrations/pos/order-status";
import {
  initiateProviderRefund,
  settleCancelledOrderPayment,
} from "@/integrations/payments/refund";

export const MAX_POS_DELIVERY_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 4000;
const BACKOFF_MULTIPLIER = 4;

/** Stable external order id the POS bridge treats as the Marketplace order id. */
export function externalOrderIdFor(orderId: number): string {
  return `mkt_ord_${orderId}`;
}

/* --------------------------- delivery journal --------------------------- */

/**
 * Create the at-least-once journal row for a fresh order. Idempotent: if the
 * order is already journaled (retried checkout / crash-between-create-and-
 * enqueue), no second row is created. Only encloses restaurants whose POS
 * integration is ACTIVE — demo/legacy restaurants with no live connection
 * never spawn delivery rows. Returns the row id when newly created, or null
 * when skipped or already known.
 *
 * Note this gate is deliberately LOOSER than `hasActiveIntegration`, which the
 * checkout gate uses. Checkout decides what may be *sold*, so it demands the
 * full deliverable set (ACTIVE + a POS restaurant id + a sealed webhook
 * secret). This decides whether an already-admitted order gets a journal row,
 * and a row that later finds the integration not-ready is recorded as a
 * retryable failure by `attemptPosDelivery` — so an order placed seconds before
 * the secret lands still goes out, instead of being silently dropped for want
 * of a row.
 */
export async function enqueueOrderDelivery(orderId: number): Promise<number | null> {
  const [orderRow] = await db
    .select({ restaurantId: orders.restaurantId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!orderRow) return null;

  const [rec] = await db
    .select({ status: integrationRecords.status })
    .from(integrationRecords)
    .where(eq(integrationRecords.restaurantId, orderRow.restaurantId))
    .limit(1);
  if (rec?.status !== "active") return null;

  const [row] = await db
    .insert(posOrderDeliveries)
    .values({
      marketplaceOrderId: orderId,
      externalOrderId: externalOrderIdFor(orderId),
      restaurantId: orderRow.restaurantId,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
    })
    .onConflictDoNothing({ target: posOrderDeliveries.marketplaceOrderId })
    .returning({ id: posOrderDeliveries.id });
  return row?.id ?? null;
}

/** Due PENDING deliveries (SKIP LOCKED so concurrent drains never double-grab). */
export async function getDuePosDeliveryIds(limit = 20): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id
       FROM marketplace_pos_order_deliveries
      WHERE status = 'PENDING'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY updated_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map((r) => Number(r.id));
}

export interface PosDeliveryContext {
  delivery: PosOrderDeliveryRow;
  order: OrderRow;
  marketplaceId: string | null;
  integrationActive: boolean;
  sealedSecret: string | null;
  /** Authoritative branch/outlet from the integration record (may be null). */
  posBranchId: string | null;
  posOutletId: string | null;
}

/** Load the delivery row plus everything needed to ship it to the POS. */
export async function loadPosDeliveryContext(deliveryId: number): Promise<PosDeliveryContext | null> {
  const [row] = await db
    .select({
      delivery: posOrderDeliveries,
      order: orders,
      marketplaceId: restaurants.marketplaceId,
      integrationStatus: integrationRecords.status,
      webhookSecret: integrationRecords.webhookSecret,
      integrationBranchId: integrationRecords.posBranchId,
      integrationOutletId: integrationRecords.posOutletId,
    })
    .from(posOrderDeliveries)
    .innerJoin(orders, eq(orders.id, posOrderDeliveries.marketplaceOrderId))
    .innerJoin(restaurants, eq(restaurants.id, posOrderDeliveries.restaurantId))
    .leftJoin(integrationRecords, eq(integrationRecords.restaurantId, posOrderDeliveries.restaurantId))
    .where(eq(posOrderDeliveries.id, deliveryId))
    .limit(1);
  if (!row) return null;
  return {
    delivery: row.delivery,
    order: row.order,
    marketplaceId: row.marketplaceId,
    integrationActive: row.integrationStatus === "active",
    sealedSecret: row.webhookSecret,
    posBranchId: row.integrationBranchId,
    posOutletId: row.integrationOutletId,
  };
}

/**
 * Atomically claim the next attempt. Only one caller wins a given attempt;
 * a loser gets null and bails (the POS side is idempotent on external_order_id
 * anyway, so racing sends are safe, but we avoid needless POSTs).
 */
export async function claimPosDeliveryAttempt(deliveryId: number): Promise<PosOrderDeliveryRow | null> {
  const [row] = await db
    .update(posOrderDeliveries)
    .set({ attempts: sqlPlusOne(), updatedAt: new Date() })
    .where(and(eq(posOrderDeliveries.id, deliveryId), eq(posOrderDeliveries.status, "PENDING")))
    .returning();
  return row ?? null;
}

function sqlPlusOne() {
  return sql`${posOrderDeliveries.attempts} + 1`;
}

/**
 * Mark a delivered order (journal + orders snapshot) after POS acknowledged.
 * The authoritative branch/outlet from the integration record are persisted on
 * the order so the inbound status webhook can reject cross-branch claims.
 */
export async function recordPosDeliverySuccess(
  deliveryId: number,
  posOrderId: number | null,
  marketplaceOrderId: number,
  opts: { at?: Date; branchId?: string | null; outletId?: string | null } = {},
): Promise<void> {
  const at = opts.at ?? new Date();
  await db
    .update(posOrderDeliveries)
    .set({
      status: "DELIVERED",
      posOrderId: posOrderId ?? undefined,
      deliveredAt: at,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: at,
    })
    .where(eq(posOrderDeliveries.id, deliveryId));
  await db
    .update(orders)
    .set({
      posOrderId: posOrderId ?? undefined,
      posDeliveryStatus: "DELIVERED",
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.outletId ? { outletId: opts.outletId } : {}),
    })
    .where(eq(orders.id, marketplaceOrderId));
}

/**
 * Record a failed attempt. Retryable failures (5xx, timeout, network, tenant
 * not yet active) keep the row PENDING with a ×4 backoff; deterministic
 * failures (401/403/422…) or an exhausted attempt budget go terminal FAILED.
 * Returns true when the delivery reached its terminal state.
 */
export async function recordPosDeliveryFailure(
  deliveryId: number,
  error: string,
  retryable: boolean,
  marketplaceOrderId: number,
  attempts: number,
  at = new Date(),
): Promise<boolean> {
  const terminal = !retryable || attempts >= MAX_POS_DELIVERY_ATTEMPTS;
  const backoffMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempts);
  // Phase 7 — add 0..30% jitter so a burst of failures does not resync into
  // thundering-herd retries. Deterministic ×4 base + multiplier are preserved.
  const jitterMs = Math.floor(Math.random() * Math.round(backoffMs * 0.3));
  await db
    .update(posOrderDeliveries)
    .set({
      status: terminal ? "FAILED" : "PENDING",
      lastError: error.slice(0, 2000),
      nextAttemptAt: terminal ? null : new Date(at.getTime() + backoffMs + jitterMs),
      updatedAt: at,
    })
    .where(eq(posOrderDeliveries.id, deliveryId));
  if (terminal) {
    // Mark the order first — the customer-facing "we couldn't reach the
    // kitchen" state reads this column, so it must not wait on the refund.
    const [failed] = await db
      .update(orders)
      .set({ posDeliveryStatus: "FAILED" })
      .where(eq(orders.id, marketplaceOrderId))
      .returning({
        restaurantId: orders.restaurantId,
        externalOrderId: orders.externalOrderId,
      });

    // An order the kitchen never saw is an order nobody will deliver. If the
    // customer already paid, that money has to come back - otherwise a charged
    // order is stranded with a fictional courier on the tracking page.
    //
    // The settlement (REFUND_PENDING / PAYMENT_CANCELLED write) is AWAITED
    // before `recordPosDeliveryFailure` returns, so a process exit at any
    // later instant can never silently lose the refund intent: the row is
    // durably REFUND_PENDING and the reconciliation job's REFUND_STUCK check
    // surfaces whatever the provider never confirmed. Only the provider HTTP
    // call is fire-and-forget - it is idempotent via the audit ledger and its
    // own errors are recorded inside refund.ts. Covers every captured state
    // (PAID / PARTIAL / PARTIALLY_REFUNDED), not just PAID; an UNPAID (COD)
    // order simply closes its pending payment row.
    if (failed?.externalOrderId) {
      const payment = await settleCancelledOrderPayment(
        failed.restaurantId,
        failed.externalOrderId,
        "order could not be delivered to the restaurant",
      );
      if (payment) {
        void initiateProviderRefund(
          payment,
          "order could not be delivered to the restaurant",
        ).catch((e) => console.error("[pos-delivery] provider refund initiation errored", e));
      }
    }
  }
  return terminal;
}

/* --------------------------- status webhooks ---------------------------- */

export type ApplyOrderStatusResult =
  | { outcome: "applied" }
  | { outcome: "duplicate" }
  | { outcome: "replay_conflict" }
  | { outcome: "skipped"; reason: string; current?: string; next?: string };

/**
 * Apply one order-status webhook exactly once inside a transaction:
 *   1. order resolved by (restaurant, external_order_id) — wrong tenant /
 *      unknown order never mutates.
 *   2. pos_order_id mismatch → skipped (never silently overwrite a binding).
 *   3. event_id ledger wins → replays resolve as "duplicate", no mutation.
 *   4. canonical mapping via order-status.ts, then forward-only guard
 *      (canTransition) + ACCEPTED absorb + same-state idempotent no-op.
 * A verified-but-irrelevant event returns "skipped" so the POS outbox stops
 * retrying instead of looping forever. Audit rows land in integration_audit.
 */
export async function applyOrderStatusTransition(opts: {
  restaurantId: number;
  eventId: string;
  externalOrderId: string;
  posOrderId: number | null;
  status: string;
  /** Branch/outlet the event claims (optional; absent for legacy webhooks). */
  outletId?: string | null;
  branchId?: string | null;
  /** sha256 of the raw webhook body — persists with the ledger row. */
  payloadHash?: string | null;
}): Promise<ApplyOrderStatusResult> {
  const now = new Date();
  const mapped = mapPosStatusToMarketplaceStatus(opts.status);
  if (!mapped) {
    await recordIntegrationAudit(opts.restaurantId, "ORDER_STATUS_REJECTED", { actor: "system" }, {
      event_id: opts.eventId,
      external_order_id: opts.externalOrderId,
      status: opts.status,
      reason: "UNKNOWN_STATUS",
    });
    return { outcome: "skipped", reason: "UNKNOWN_STATUS", next: opts.status };
  }

  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(eq(orders.restaurantId, opts.restaurantId), eq(orders.externalOrderId, opts.externalOrderId)),
      )
      .limit(1);
    if (!order) return { outcome: "skipped", reason: "ORDER_NOT_FOUND", next: mapped } as const;

    if (
      opts.posOrderId != null &&
      order.posOrderId != null &&
      Number(opts.posOrderId) !== Number(order.posOrderId)
    ) {
      return { outcome: "skipped", reason: "POS_ORDER_ID_MISMATCH", current: order.integrationStatus, next: mapped } as const;
    }

    // Phase 7 — cross-branch/outlet claim guard. The order's stored branch/
    // outlet (persisted at delivery time) is the authoritative binding; an
    // event whose claim conflicts is acknowledged-but-skipped (no mutation), so
    // the POS outbox converges without ever letting a forged or stale frame
    // rewrite a status under the wrong branch identity.
    if (opts.outletId && order.outletId && opts.outletId !== order.outletId) {
      return { outcome: "skipped", reason: "OUTLET_MISMATCH", current: order.integrationStatus, next: mapped } as const;
    }
    if (opts.branchId && order.branchId && opts.branchId !== order.branchId) {
      return { outcome: "skipped", reason: "BRANCH_MISMATCH", current: order.integrationStatus, next: mapped } as const;
    }

    const inserted = await tx
      .insert(marketplaceOrderEvents)
      .values({
        restaurantId: opts.restaurantId,
        eventId: opts.eventId,
        externalOrderId: opts.externalOrderId,
        posOrderId: opts.posOrderId,
        status: mapped,
        payloadHash: opts.payloadHash ?? null,
      })
      .onConflictDoNothing({ target: marketplaceOrderEvents.eventId })
      .returning({ id: marketplaceOrderEvents.id });
    if (!inserted.length) {
      // Replay of a known event_id: compare the stored payload hash so a
      // same-id frame with different content surfaces as a conflict instead of
      // being silently deduped. Both sides must have a hash to compare; legacy
      // rows without one keep the plain "duplicate" behavior.
      const [existing] = await tx
        .select({ payloadHash: marketplaceOrderEvents.payloadHash })
        .from(marketplaceOrderEvents)
        .where(eq(marketplaceOrderEvents.eventId, opts.eventId))
        .limit(1);
      if (existing?.payloadHash && opts.payloadHash && existing.payloadHash !== opts.payloadHash) {
        return { outcome: "replay_conflict" } as const;
      }
      return { outcome: "duplicate" } as const;
    }

    const current = order.integrationStatus;

    // Same-state frame (different event_id): idempotent success, no status
    // mutation — only the missing POS binding may be backfilled.
    if (current === mapped) {
      if (opts.posOrderId != null && order.posOrderId == null) {
        await tx
          .update(orders)
          .set({ posOrderId: opts.posOrderId })
          .where(eq(orders.id, order.id));
      }
      return { outcome: "applied" } as const;
    }

    if (isAbsorbedAccepted(current, mapped)) {
      // First-mile acceptance on an already-kitchen-ready order: the event is
      // recorded (ledger row above) but the customer timeline never regresses.
      return { outcome: "applied" } as const;
    }

    if (!canTransition(current, mapped)) {
      return { outcome: "skipped", reason: "INVALID_TRANSITION", current, next: mapped } as const;
    }

    await tx
      .update(orders)
      .set({
        integrationStatus: mapped,
        statusUpdatedAt: now,
        ...(opts.posOrderId != null && order.posOrderId == null ? { posOrderId: opts.posOrderId } : {}),
      })
      .where(eq(orders.id, order.id));
    return { outcome: "applied" } as const;
  });

  const auditEvent =
    result.outcome === "duplicate"
      ? "ORDER_STATUS_DUPLICATE"
      : result.outcome === "replay_conflict"
        ? "ORDER_STATUS_REPLAY_CONFLICT"
        : result.outcome === "skipped"
          ? "ORDER_STATUS_REJECTED"
          : "ORDER_STATUS_UPDATED";
  await recordIntegrationAudit(opts.restaurantId, auditEvent, { actor: "system" }, {
    event_id: opts.eventId,
    external_order_id: opts.externalOrderId,
    status: mapped,
    pos_order_id: opts.posOrderId,
    current: "current" in result ? result.current : undefined,
    reason: "reason" in result ? result.reason : undefined,
  });
  return result;
}