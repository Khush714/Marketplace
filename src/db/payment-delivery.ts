import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  integrationRecords,
  marketplacePayments,
  marketplacePosPaymentDeliveries,
  orders,
  restaurants,
  type MarketplacePosPaymentDeliveryRow,
  type OrderRow,
} from "@/db/schema";

/**
 * At-least-once delivery journal for Marketplace → POS payment webhook pushes
 * (Phase 6). Mirror of the order-delivery journal (pos-delivery.ts):
 *   PENDING   → owed; drain attempts it (backoff ×4, max 5 attempts)
 *   DELIVERED → POS acknowledged (its own event_id dedup makes replays safe)
 *   FAILED    → terminal outcome that must NOT be retried
 * One row per (payment reference, bridge event) — the unique event_id is the
 * deterministic bridge event id, so a journal replay always sends the same
 * event_id and the POS webhook_events ledger dedupes it.
 */

export const MAX_POS_PAYMENT_DELIVERY_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 4000;
const BACKOFF_MULTIPLIER = 4;

export interface PaymentDeliveryInsert {
  paymentId: number;
  externalOrderId: string;
  restaurantId: number;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
}

export async function enqueuePaymentDelivery(input: PaymentDeliveryInsert): Promise<number | null> {
  const [row] = await db
    .insert(marketplacePosPaymentDeliveries)
    .values({
      marketplacePaymentId: input.paymentId,
      externalOrderId: input.externalOrderId,
      restaurantId: input.restaurantId,
      eventType: input.eventType,
      eventId: input.eventId,
      payload: input.payload,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
    })
    .onConflictDoNothing({ target: marketplacePosPaymentDeliveries.eventId })
    .returning({ id: marketplacePosPaymentDeliveries.id });
  return row?.id ?? null;
}

export async function getDuePosPaymentDeliveryIds(limit = 20): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id
       FROM marketplace_pos_payment_deliveries
      WHERE status = 'PENDING'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY updated_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map((r) => Number(r.id));
}

export interface PosPaymentDeliveryContext {
  delivery: MarketplacePosPaymentDeliveryRow;
  payment: { id: number; reference: string; provider: string; providerPaymentId: string | null; amountCents: number; currency: string; method: string | null };
  order: OrderRow;
  marketplaceId: string | null;
  integrationActive: boolean;
  sealedSecret: string | null;
  /** Authoritative branch/outlet from the integration record (may be null). */
  posBranchId: string | null;
  posOutletId: string | null;
}

export async function loadPosPaymentDeliveryContext(
  deliveryId: number,
): Promise<PosPaymentDeliveryContext | null> {
  const [row] = await db
    .select({
      delivery: marketplacePosPaymentDeliveries,
      payment: {
        id: marketplacePayments.id,
        reference: marketplacePayments.paymentReference,
        provider: marketplacePayments.provider,
        providerPaymentId: marketplacePayments.providerPaymentId,
        amountCents: marketplacePayments.amountCents,
        currency: marketplacePayments.currency,
        method: marketplacePayments.method,
      },
      order: orders,
      marketplaceId: restaurants.marketplaceId,
      integrationStatus: integrationRecords.status,
      webhookSecret: integrationRecords.webhookSecret,
      integrationBranchId: integrationRecords.posBranchId,
      integrationOutletId: integrationRecords.posOutletId,
    })
    .from(marketplacePosPaymentDeliveries)
    .innerJoin(marketplacePayments, eq(marketplacePayments.id, marketplacePosPaymentDeliveries.marketplacePaymentId))
    .innerJoin(orders, eq(orders.id, marketplacePayments.marketplaceOrderId))
    .innerJoin(restaurants, eq(restaurants.id, marketplacePosPaymentDeliveries.restaurantId))
    .leftJoin(integrationRecords, eq(integrationRecords.restaurantId, marketplacePosPaymentDeliveries.restaurantId))
    .where(eq(marketplacePosPaymentDeliveries.id, deliveryId))
    .limit(1);
  if (!row) return null;
  return {
    delivery: row.delivery,
    payment: row.payment,
    order: row.order,
    marketplaceId: row.marketplaceId,
    integrationActive: row.integrationStatus === "active",
    sealedSecret: row.webhookSecret,
    posBranchId: row.integrationBranchId,
    posOutletId: row.integrationOutletId,
  };
}

export async function claimPaymentDeliveryAttempt(deliveryId: number): Promise<MarketplacePosPaymentDeliveryRow | null> {
  const [row] = await db
    .update(marketplacePosPaymentDeliveries)
    .set({ attempts: sql`${marketplacePosPaymentDeliveries.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(marketplacePosPaymentDeliveries.id, deliveryId), eq(marketplacePosPaymentDeliveries.status, "PENDING")))
    .returning();
  return row ?? null;
}

export async function recordPaymentDeliverySuccess(deliveryId: number, at = new Date()): Promise<void> {
  await db
    .update(marketplacePosPaymentDeliveries)
    .set({ status: "DELIVERED", deliveredAt: at, lastError: null, nextAttemptAt: null, updatedAt: at })
    .where(eq(marketplacePosPaymentDeliveries.id, deliveryId));
}

export async function recordPaymentDeliveryFailure(
  deliveryId: number,
  error: string,
  retryable: boolean,
  attempts: number,
  at = new Date(),
): Promise<boolean> {
  const terminal = !retryable || attempts >= MAX_POS_PAYMENT_DELIVERY_ATTEMPTS;
  const backoffMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempts);
  const jitterMs = Math.floor(Math.random() * Math.round(backoffMs * 0.3));
  await db
    .update(marketplacePosPaymentDeliveries)
    .set({
      status: terminal ? "FAILED" : "PENDING",
      lastError: error.slice(0, 2000),
      nextAttemptAt: terminal ? null : new Date(at.getTime() + backoffMs + jitterMs),
      updatedAt: at,
    })
    .where(eq(marketplacePosPaymentDeliveries.id, deliveryId));
  return terminal;
}

export function paymentDeliveryEventId(reference: string, eventType: string, suffix?: string): string {
  return suffix ? `${reference}:${eventType}:${suffix}` : `${reference}:${eventType}`;
}