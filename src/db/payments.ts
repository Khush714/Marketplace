import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recordIntegrationAudit } from "@/db/queries";
import { externalOrderIdFor } from "@/db/pos-delivery";
import {
  marketplacePaymentEvents,
  marketplacePayments,
  orders,
  restaurants,
  type OrderRow,
  type MarketplacePaymentRow,
} from "@/db/schema";
import { channelVerifiesSignature, type PaymentChannel } from "@/lib/payment-security-core";

/**
 * Marketplace payment core (Phase 6). Owns the payment state machine,
 * idempotent provider-event ledger, and the financial audit trail. The
 * Marketplace is the payment owner: money facts are recorded here and mirrored
 * to the POS through the payment bridge — never the reverse.
 *
 * Payment states (orthogonal to order status):
 *   UNPAID · PAYMENT_PENDING · PAID · PARTIAL · FAILED · REFUND_PENDING ·
 *   PARTIALLY_REFUNDED · REFUNDED · PAYMENT_CANCELLED
 *
 * Money invariants:
 *   - amount + currency are verified against the ORDER row before anything
 *     becomes PAID; a mismatch lands the payment in FAILED* with a
 *     PAYMENT_AMOUNT_MISMATCH / PAYMENT_CURRENCY_MISMATCH failure code and the
 *     order stays PAYMENT_PENDING (never auto-paid).
 *   - every transition records whether the channel it arrived on carried a
 *     verified provider signature (`signature_verified`): the webhook's HMAC
 *     and the checkout triple say yes, the local dev stand-in says no. A row
 *     never claims verification the caller did not demonstrate.
 *   - a refund is confirmed only by the provider (refund.completed/webhook);
 *     the Marketplace never invents one.
 */

export const ONLINE_PAYMENT_METHODS = new Set(["upi", "card", "netbanking", "wallet", "paylater", "emi"]);

export function isOnlinePayment(method: string): boolean {
  return ONLINE_PAYMENT_METHODS.has(String(method ?? "").toLowerCase());
}

export function externalPaymentReferencefor(): string {
  return `PAY-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export function paymentDerivedEventId(reference: string, eventType: string): string {
  return `${reference}:${eventType}`;
}

function payloadHashOf(rawBody: string): string {
  return createHash("sha256").update(rawBody || "").digest("hex");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------- payment records ------------------------------- */

export interface PaymentRecordView {
  id: number;
  reference: string;
  orderId: number;
  externalOrderId: string;
  restaurantId: number;
  provider: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountCents: number;
  currency: string;
  status: string;
  /** Whether a signature-verified provider channel vouches for this status. */
  signatureVerified: boolean;
  method: string | null;
  refundedAmountCents: number;
}

function toPaymentView(r: MarketplacePaymentRow): PaymentRecordView {
  return {
    id: r.id,
    reference: r.paymentReference,
    orderId: r.marketplaceOrderId,
    externalOrderId: r.externalOrderId,
    restaurantId: r.restaurantId,
    provider: r.provider,
    providerOrderId: r.providerOrderId,
    providerPaymentId: r.providerPaymentId,
    amountCents: r.amountCents,
    currency: r.currency,
    status: r.status,
    signatureVerified: r.signatureVerified,
    method: r.method,
    refundedAmountCents: r.refundedAmountCents,
  };
}

/**
 * Create the payment record for a freshly placed order. Online methods start
 * PAYMENT_PENDING (and the order is held out of the POS until captured); COD /
 * cash start UNPAID (money is collected at delivery through the POS cash flow).
 * Returns the reference; throws uniquely when the order already has a live
 * payment (checkout is guarded by the client_request_id idempotency key).
 */
export async function createPaymentRecord(opts: {
  order: Pick<OrderRow, "id" | "restaurantId" | "externalOrderId" | "totalCents">;
  paymentMethod: string;
  provider?: string;
}): Promise<{ reference: string; status: string }> {
  // Retried checkout (same client_request_id) must not mint a second payment:
  // reuse the order's existing live payment.
  const existing = await getActivePaymentByOrder(opts.order.id);
  if (existing) return { reference: existing.reference, status: existing.status };

  const online = isOnlinePayment(opts.paymentMethod);
  const status = online ? "PAYMENT_PENDING" : "UNPAID";
  const provider = opts.provider ?? (online ? "razorpay" : "cash");
  const reference = externalPaymentReferencefor();

  const [row] = await db
    .insert(marketplacePayments)
    .values({
      paymentReference: reference,
      marketplaceOrderId: opts.order.id,
      externalOrderId: opts.order.externalOrderId ?? externalOrderIdFor(opts.order.id),
      restaurantId: opts.order.restaurantId,
      provider,
      amountCents: opts.order.totalCents,
      amount: round2(opts.order.totalCents / 100),
      currency: "INR",
      status,
    })
    .onConflictDoNothing({ target: [marketplacePayments.paymentReference] })
    .returning();

  await db.update(orders).set({ paymentStatus: status }).where(eq(orders.id, opts.order.id));

  await recordIntegrationAudit(opts.order.restaurantId, "PAYMENT_INITIATED", { actor: "system" }, {
    order_id: opts.order.id,
    external_order_id: opts.order.externalOrderId ?? externalOrderIdFor(opts.order.id),
    payment_reference: reference,
    provider,
    amount_cents: opts.order.totalCents,
    payment_status: status,
  });

  return { reference: row?.paymentReference ?? reference, status };
}

export async function getPaymentByProvider(
  provider: string,
  providerPaymentId: string,
): Promise<PaymentRecordView | null> {
  const [row] = await db
    .select()
    .from(marketplacePayments)
    .where(
      and(
        eq(marketplacePayments.provider, provider),
        eq(marketplacePayments.providerPaymentId, providerPaymentId),
      ),
    )
    .limit(1);
  return row ? toPaymentView(row) : null;
}

/** Bind the provider's order/session id allocated at checkout (idempotent). */
export async function bindProviderOrderId(reference: string, providerOrderId: string): Promise<void> {
  await db
    .update(marketplacePayments)
    .set({ providerOrderId, updatedAt: new Date() })
    .where(eq(marketplacePayments.paymentReference, reference));
}

/**
 * The live payment for an order, if any. FAILED is live too: a declined
 * attempt is exactly what the retry paths (/pay/start, /pay/verify) must find
 * again — leaving it out of this set made every resume answer 404/409 after
 * the first card decline, even though the customer was still owed a payment.
 */
export async function getActivePaymentByOrder(orderId: number): Promise<PaymentRecordView | null> {
  const rows = await db
    .select()
    .from(marketplacePayments)
    .where(
      and(
        eq(marketplacePayments.marketplaceOrderId, orderId),
        inArray(marketplacePayments.status, ["UNPAID", "PAYMENT_PENDING", "FAILED", "REFUND_PENDING", "PAID"]),
      ),
    )
    .orderBy(marketplacePayments.id)
    .limit(1);
  return rows[0] ? toPaymentView(rows[0]) : null;
}

export async function getPaymentByReference(reference: string): Promise<PaymentRecordView | null> {
  const [row] = await db
    .select()
    .from(marketplacePayments)
    .where(eq(marketplacePayments.paymentReference, reference))
    .limit(1);
  return row ? toPaymentView(row) : null;
}

/* ------------------- provider event ledger + transitions ------------------- */

export type ProviderEventOutcome =
  | { outcome: "duplicate" }
  | { outcome: "replay_conflict" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "applied"; payment: PaymentRecordView; orderId: number; deliverToPos: boolean };

/**
 * Whether a NEW provider attempt may still land on this row. A row that is
 * captured (PAID) or inside the refund lifecycle is settled money: a late
 * event for a superseded attempt must neither rebind `provider_payment_id`
 * (the refund would then target the wrong payment) nor rewrite its status.
 */
function paymentStatusAllowsRetry(status: string): boolean {
  return status === "UNPAID" || status === "PAYMENT_PENDING" || status === "FAILED";
}

/**
 * Process one Razorpay provider webhook transactionally:
 *   1. `event_id` ledger insert wins — replays resolve "duplicate", no re-write.
 *   2. payment resolved by provider_payment_id (the payment.entity.id, or
 *      refund.entity.payment_id for refund events).
 *   3. amount + currency verified against the order for captures; a mismatch
 *      is recorded (FAILED + PAYMENT_AMOUNT_MISMATCH) and NEVER becomes PAID.
 *   4. payment row + orders.payment_status advance together, audited, each
 *      transition stamped with whether `channel` proved itself with a verified
 *      provider signature (see payment-security-core).
 * `deliverToPos` tells the caller which events must be pushed to the POS
 * bridge (captured → money movement; refunds → refund lifecycle).
 */
export async function applyProviderPaymentEvent(opts: {
  eventId: string;
  eventType: string;
  entity: RazorpayPaymentEntity | RazorpayRefundEntity;
  rawBody?: string;
  /** Which verified channel this event arrived on — see PaymentChannel. */
  channel: PaymentChannel;
}): Promise<ProviderEventOutcome> {
  const { eventId, eventType, entity } = opts;
  const provider = "razorpay";
  const signatureVerified = channelVerifiesSignature(opts.channel);

  const isRefund = eventType.startsWith("refund.");
  const providerPaymentId = isRefund
    ? String((entity as RazorpayRefundEntity).payment_id ?? "").trim()
    : String((entity as RazorpayPaymentEntity).id ?? "").trim();
  if (!providerPaymentId) return { outcome: "ignored", reason: "MISSING_PROVIDER_PAYMENT_ID" };

  const refundId = isRefund ? String((entity as RazorpayRefundEntity).id ?? "").trim() : null;
  const amountPaise = Number((entity as { amount?: number }).amount ?? 0);
  const currency = String((entity as { currency?: string }).currency ?? "INR").toUpperCase();

  const outcome = await db.transaction(async (tx) => {
    // 1. Idempotent event ledger (first insert wins).
    const [ledger] = await tx
      .insert(marketplacePaymentEvents)
      .values({
        eventId,
        provider,
        eventType,
        paymentReference: null,
        payloadHash: opts.rawBody ? payloadHashOf(opts.rawBody) : null,
      })
      .onConflictDoNothing({ target: marketplacePaymentEvents.eventId })
      .returning({ id: marketplacePaymentEvents.id });
    if (!ledger) {
      // Replay of a known event_id: compare the stored payload hash. A same-id
      // frame carrying different content is a conflict (not a silent dedup) —
      // it means the POS/provider sent visibly different bytes for one id.
      const [existing] = await tx
        .select({ payloadHash: marketplacePaymentEvents.payloadHash })
        .from(marketplacePaymentEvents)
        .where(eq(marketplacePaymentEvents.eventId, eventId))
        .limit(1);
      if (existing?.payloadHash && opts.rawBody && existing.payloadHash !== payloadHashOf(opts.rawBody)) {
        return { outcome: "replay_conflict" } as const;
      }
      return { outcome: "duplicate" } as const;
    }

    // 2. Resolve the payment row. Primary key: provider payment id (set on a
    //    prior event). First sighting fallback: the payment entity carries its
    //    razorpay order_id — allocated at checkout — so a capture before any
    //    other event still binds pay_… to the recorded order.
    let pay = await tx
      .select()
      .from(marketplacePayments)
      .where(and(eq(marketplacePayments.provider, provider), eq(marketplacePayments.providerPaymentId, providerPaymentId)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!pay && !isRefund) {
      const orderId = String((entity as RazorpayPaymentEntity).order_id ?? "").trim();
      if (orderId) {
        const [byOrder] = await tx
          .select()
          .from(marketplacePayments)
          .where(and(eq(marketplacePayments.provider, provider), eq(marketplacePayments.providerOrderId, orderId)))
          .limit(1);
        if (!byOrder) return { outcome: "ignored", reason: "PAYMENT_NOT_FOUND" } as const;
        // Rebinding this way IS the retry story — a declined attempt leaves the
        // row bound to the old pay_…, and the successful attempt's capture
        // arrives under a new id. But only while the row is still retryable:
        // Razorpay redelivers payment.failed out of order (a 429/5xx here is
        // retried for days), so a late failure for a superseded attempt must
        // never rebind or downgrade a capture that already settled.
        if (
          byOrder.providerPaymentId &&
          byOrder.providerPaymentId !== providerPaymentId &&
          !paymentStatusAllowsRetry(byOrder.status)
        ) {
          return { outcome: "ignored", reason: "PAYMENT_ATTEMPT_SUPERSEDED" } as const;
        }
        pay = byOrder;
        await tx
          .update(marketplacePayments)
          .set({ providerPaymentId, updatedAt: new Date() })
          .where(eq(marketplacePayments.id, byOrder.id));
      }
    }
    if (!pay) return { outcome: "ignored", reason: "PAYMENT_NOT_FOUND" } as const;

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, pay.marketplaceOrderId))
      .limit(1);
    if (!order || order.restaurantId !== pay.restaurantId) {
      return { outcome: "ignored", reason: "ORDER_OWNERSHIP_MISMATCH" } as const;
    }

    await tx
      .update(marketplacePaymentEvents)
      .set({ paymentReference: pay.paymentReference })
      .where(eq(marketplacePaymentEvents.id, ledger.id));

    const at = new Date();

    if (eventType === "payment.captured") {
      // 3. Money verification — amount (paise) and currency against the order.
      const amountMatches = amountPaise === pay.amountCents;
      const currencyMatches = currency === pay.currency;
      if (!amountMatches || !currencyMatches) {
        const code = !currencyMatches ? "PAYMENT_CURRENCY_MISMATCH" : "PAYMENT_AMOUNT_MISMATCH";
        const message = !currencyMatches
          ? `capture in ${currency}, expected ${pay.currency}`
          : `capture amount ${amountPaise} != order total ${pay.amountCents}`;
        await tx
          .update(marketplacePayments)
          .set({
            status: "FAILED",
            providerPaymentId,
            method: methodOf(entity),
            failedAt: at,
            failureCode: code,
            failureMessage: message,
            signatureVerified,
            updatedAt: at,
          })
          .where(eq(marketplacePayments.id, pay.id));
        await recordIntegrationAudit(pay.restaurantId, "PAYMENT_EXCEPTION", { actor: "system" }, {
          event_id: eventId,
          order_id: order.id,
          external_order_id: pay.externalOrderId,
          payment_reference: pay.paymentReference,
          failure_code: code,
          failure_message: message,
        });
        return { outcome: "applied", payment: { ...toPaymentView(pay), status: "FAILED", method: methodOf(entity), signatureVerified }, orderId: order.id, deliverToPos: false } as const;
      }

      await tx
        .update(marketplacePayments)
        .set({
          status: "PAID",
          providerPaymentId,
          method: methodOf(entity),
          capturedAt: at,
          failedAt: null,
          failureCode: null,
          failureMessage: null,
          signatureVerified,
          updatedAt: at,
        })
        .where(eq(marketplacePayments.id, pay.id));
      await tx.update(orders).set({ paymentStatus: "PAID" }).where(eq(orders.id, order.id));
      await recordIntegrationAudit(pay.restaurantId, "PAYMENT_SUCCEEDED", { actor: "system" }, {
        event_id: eventId,
        order_id: order.id,
        external_order_id: pay.externalOrderId,
        payment_reference: pay.paymentReference,
        provider_payment_id: providerPaymentId,
        amount_cents: amountPaise,
        signature_verified: signatureVerified,
      });
      return { outcome: "applied", payment: { ...toPaymentView(pay), status: "PAID", providerPaymentId, method: methodOf(entity), signatureVerified }, orderId: order.id, deliverToPos: true } as const;
    }

    if (eventType === "payment.failed") {
      // Captured or refunding money is never downgraded by a failure event —
      // not on a duplicate for the same payment id, not on a redelivery that
      // resolved through the order-id fallback above.
      if (!paymentStatusAllowsRetry(pay.status)) {
        return { outcome: "ignored", reason: "PAYMENT_ALREADY_SETTLED" } as const;
      }
      const code = String((entity as RazorpayPaymentEntity).error_code ?? "PAYMENT_FAILED").slice(0, 64) || "PAYMENT_FAILED";
      const message = String((entity as RazorpayPaymentEntity).error_description ?? "").slice(0, 500) || null;
      await tx
        .update(marketplacePayments)
        .set({ status: "FAILED", providerPaymentId, failedAt: at, failureCode: code, failureMessage: message, signatureVerified, updatedAt: at })
        .where(eq(marketplacePayments.id, pay.id));
      await tx.update(orders).set({ paymentStatus: "FAILED" }).where(eq(orders.id, order.id));
      await recordIntegrationAudit(pay.restaurantId, "PAYMENT_FAILED", { actor: "system" }, {
        event_id: eventId,
        order_id: order.id,
        external_order_id: pay.externalOrderId,
        payment_reference: pay.paymentReference,
        failure_code: code,
        signature_verified: signatureVerified,
      });
      return { outcome: "applied", payment: { ...toPaymentView(pay), status: "FAILED", providerPaymentId, signatureVerified }, orderId: order.id, deliverToPos: false } as const;
    }

    if (eventType === "refund.completed" || eventType === "refund.processed") {
      const refundAmount = Number.isFinite(amountPaise) && amountPaise > 0 ? amountPaise : 0;
      const nextRefunded = Math.min(pay.amountCents, pay.refundedAmountCents + refundAmount);
      const status = nextRefunded >= pay.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await tx
        .update(marketplacePayments)
        .set({ status, refundedAmountCents: nextRefunded, refundedAt: at, signatureVerified, updatedAt: at })
        .where(eq(marketplacePayments.id, pay.id));
      await tx.update(orders).set({ paymentStatus: status }).where(eq(orders.id, order.id));
      await recordIntegrationAudit(pay.restaurantId, "REFUND_SUCCEEDED", { actor: "system" }, {
        event_id: eventId,
        order_id: order.id,
        external_order_id: pay.externalOrderId,
        payment_reference: pay.paymentReference,
        refund_id: refundId,
        refund_amount_cents: refundAmount,
        total_refunded_cents: nextRefunded,
        status,
        signature_verified: signatureVerified,
      });
      return { outcome: "applied", payment: { ...toPaymentView(pay), status, refundedAmountCents: nextRefunded, signatureVerified }, orderId: order.id, deliverToPos: true } as const;
    }

    if (eventType === "refund.failed") {
      await tx
        .update(marketplacePayments)
        .set({ failureCode: "REFUND_FAILED", failureMessage: String((entity as RazorpayRefundEntity).error_description ?? "refund failed").slice(0, 500), updatedAt: at })
        .where(eq(marketplacePayments.id, pay.id));
      await recordIntegrationAudit(pay.restaurantId, "REFUND_FAILED", { actor: "system" }, {
        event_id: eventId,
        order_id: order.id,
        external_order_id: pay.externalOrderId,
        payment_reference: pay.paymentReference,
        refund_id: refundId,
      });
      return { outcome: "applied", payment: toPaymentView(pay), orderId: order.id, deliverToPos: false } as const;
    }

    // Verified but unhandled provider event type (payment.authorized,
    // order.paid, etc.): acknowledge and converge, no mutation.
    return { outcome: "ignored", reason: "UNHANDLED_EVENT_TYPE" } as const;
  });

  if (outcome.outcome === "duplicate") {
    await db
      .insert(marketplacePaymentEvents)
      .values({ eventId, provider, eventType })
      .onConflictDoNothing({ target: marketplacePaymentEvents.eventId })
      .catch(() => {});
  }

  return outcome;
}

/* ------------------- cancellation / refund orchestration ------------------ */

/**
 * A payment that never captured, cancelled with the order: PAYMENT_CANCELLED,
 * no money moved, nothing to push to the POS (the order never reached it).
 */
export async function cancelPendingPayment(order: OrderRow): Promise<void> {
  const live = await getActivePaymentByOrder(order.id);
  if (!live || (live.status !== "PAYMENT_PENDING" && live.status !== "UNPAID")) return;

  await db
    .update(marketplacePayments)
    .set({ status: "PAYMENT_CANCELLED", updatedAt: new Date() })
    .where(eq(marketplacePayments.paymentReference, live.reference));
  await db.update(orders).set({ paymentStatus: "PAYMENT_CANCELLED" }).where(eq(orders.id, order.id));
  await recordIntegrationAudit(order.restaurantId, "PAYMENT_CANCELLED", { actor: "system" }, {
    order_id: order.id,
    external_order_id: order.externalOrderId ?? externalOrderIdFor(order.id),
    payment_reference: live.reference,
  });
}

/**
 * A captured payment whose order was cancelled/rejected: mark REFUND_PENDING
 * and return the payment (the caller drives the provider refund + POS push).
 * Returns null when there is no capturable/pending refund money.
 */
export async function markRefundRequested(orderId: number, reason: string | null): Promise<PaymentRecordView | null> {
  const rows = await db
    .select()
    .from(marketplacePayments)
    .where(and(eq(marketplacePayments.marketplaceOrderId, orderId), inArray(marketplacePayments.status, ["PAID", "PARTIAL", "PARTIALLY_REFUNDED"])))
    .orderBy(marketplacePayments.id)
    .limit(1);
  const pay = rows[0];
  if (!pay) return null;

  const already = pay.refundedAmountCents >= pay.amountCents;
  const status = already ? "REFUNDED" : "REFUND_PENDING";
  await db
    .update(marketplacePayments)
    .set({ status, updatedAt: new Date() })
    .where(eq(marketplacePayments.id, pay.id));
  await db.update(orders).set({ paymentStatus: status }).where(eq(orders.id, orderId));
  await recordIntegrationAudit(pay.restaurantId, "REFUND_REQUESTED", { actor: "system" }, {
    order_id: orderId,
    external_order_id: pay.externalOrderId,
    payment_reference: pay.paymentReference,
    reason: reason ?? null,
  });
  return toPaymentView({ ...pay, status });
}

function methodOf(entity: RazorpayPaymentEntity | RazorpayRefundEntity): string | null {
  const method = String((entity as RazorpayPaymentEntity).method ?? "");
  return method ? method : null;
}

/* ------------------------------ provider types ---------------------------- */

export interface RazorpayPaymentEntity {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
  method?: string;
  order_id?: string | null;
  error_code?: string | null;
  error_description?: string | null;
}

export interface RazorpayRefundEntity {
  id: string;
  payment_id?: string;
  amount?: number;
  status?: string;
  error_description?: string | null;
}

/** Confirm the order's restaurant still matches its integration (ownership). */
export async function assertOrderRestaurant(
  restaurantId: number,
  orderId: number,
): Promise<{ restaurant: typeof restaurants.$inferSelect; order: OrderRow } | null> {
  const [row] = await db
    .select()
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .where(and(eq(orders.id, orderId), eq(orders.restaurantId, restaurantId)))
    .limit(1);
  return row ? { restaurant: row.restaurants, order: row.orders } : null;
}