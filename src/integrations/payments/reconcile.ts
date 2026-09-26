import "server-only";
import { pool } from "@/db";
import { recordIntegrationAudit } from "@/db/queries";

/**
 * Payment reconciliation (Phase 6) — a self-driving classifier over the
 * Marketplace's own payment state. It surfaces divergences for the operator;
 * it NEVER silently mutates (no invented refunds / no forced captures). The
 * source of truth for money is the provider webhook ledger + payment rows, so
 * every check here is a defensive invariant that should normally be empty.
 *
 * Checks (each produces one exception per offending payment):
 *   STALE_PAYMENT_PENDING   online payment awaited > 24h with no capture/failure
 *   REFUND_STUCK            refund requested > 1h but provider never confirmed it
 *   POS_PAYMENT_MISSING     captured/refunded money never reached the POS
 *   POS_PAYMENT_DELIVERY_FAILED  a payment bridge push went terminal FAILED
 *   AMOUNT_MISMATCH         payment.amount_cents != orders.total_cents
 *   ORPHAN_EVENT            provider event never linked to a payment row
 *
 * Each run appends one PAYMENT_RECONCILED audit row with the full counts and
 * exception list so the trail doubles as the reconciliation log.
 */

export interface ReconciliationException {
  code: string;
  paymentReference: string | null;
  externalOrderId: string;
  restaurantId: number;
  detail: Record<string, unknown>;
}

export interface ReconciliationResult {
  ranAt: string;
  pass: boolean;
  checks: Record<string, number>;
  exceptions: ReconciliationException[];
}

const STALE_PAYMENT_MS = 24 * 60 * 60 * 1000;
const STUCK_REFUND_MS = 60 * 60 * 1000;

interface Row {
  reference: string;
  externalOrderId: string;
  restaurantId: number;
  [k: string]: unknown;
}

export async function reconcilePayments(): Promise<ReconciliationResult> {
  const ranAt = new Date();
  const exceptions: ReconciliationException[] = [];
  const checks: Record<string, number> = {};
  const push = (code: string, r: Row, extra: Record<string, unknown> = {}) => {
    exceptions.push({
      code,
      paymentReference: r.reference,
      externalOrderId: r.externalOrderId,
      restaurantId: Number(r.restaurantId),
      detail: extra,
    });
  };

  // 1. Stale awaited capture (online payment never captured or failed).
  const staleBefore = new Date(ranAt.getTime() - STALE_PAYMENT_MS).toISOString();
  const { rows: stale } = await pool.query<Row>(
    `SELECT p.payment_reference AS reference, p.external_order_id AS "externalOrderId", p.restaurant_id AS "restaurantId", p.updated_at
       FROM marketplace_payments p
      WHERE p.status = 'PAYMENT_PENDING'
        AND p.provider = 'razorpay'
        AND p.updated_at < $1`,
    [staleBefore],
  );
  stale.forEach((r) => push("STALE_PAYMENT_PENDING", r, { stalled_since: String(r.updated_at) }));
  checks.stale_payments = stale.length;

  // 2. Refund requested but never confirmed by the provider.
  const stuckBefore = new Date(ranAt.getTime() - STUCK_REFUND_MS).toISOString();
  const { rows: stuck } = await pool.query<Row>(
    `SELECT p.payment_reference AS reference, p.external_order_id AS "externalOrderId", p.restaurant_id AS "restaurantId",
            p.updated_at, p.refunded_amount_cents AS "refundedAmountCents", p.amount_cents AS "amountCents"
       FROM marketplace_payments p
      WHERE p.status = 'REFUND_PENDING'
        AND p.updated_at < $1`,
    [stuckBefore],
  );
  stuck.forEach((r) =>
    push("REFUND_STUCK", r, {
      refund_requested_since: String(r.updated_at),
      amount_cents: Number(r.amountCents),
      refunded_amount_cents: Number(r.refundedAmountCents),
    }),
  );
  checks.stuck_refunds = stuck.length;

  // 3. Captured/refunded money that never reached the POS through the bridge.
  const { rows: missing } = await pool.query<Row>(
    `SELECT p.payment_reference AS reference, p.external_order_id AS "externalOrderId", p.restaurant_id AS "restaurantId",
            p.status, p.captured_at
       FROM marketplace_payments p
      WHERE p.status IN ('PAID', 'PARTIAL', 'PARTIALLY_REFUNDED', 'REFUNDED')
        AND NOT EXISTS (
          SELECT 1 FROM marketplace_pos_payment_deliveries d
           WHERE d.marketplace_payment_id = p.id AND d.status = 'DELIVERED'
        )`,
  );
  missing.forEach((r) => push("POS_PAYMENT_MISSING", r, { payment_status: String(r.status), captured_at: r.captured_at ? String(r.captured_at) : null }));
  checks.pos_payment_missing = missing.length;

  // 4. Payment bridge pushes that went terminal FAILED.
  const { rows: failedDeliveries } = await pool.query<Row>(
    `SELECT p.payment_reference AS reference, p.external_order_id AS "externalOrderId", p.restaurant_id AS "restaurantId",
            d.event_type AS "eventType", d.event_id AS "eventId", d.last_error AS "lastError", d.attempts
       FROM marketplace_pos_payment_deliveries d
       JOIN marketplace_payments p ON p.id = d.marketplace_payment_id
      WHERE d.status = 'FAILED'`,
  );
  failedDeliveries.forEach((r) =>
    push("POS_PAYMENT_DELIVERY_FAILED", r, {
      event_type: String(r.eventType),
      event_id: String(r.eventId),
      attempts: Number(r.attempts),
      last_error: r.lastError ? String(r.lastError).slice(0, 300) : null,
    }),
  );
  checks.pos_payment_delivery_failed = failedDeliveries.length;

  // 5. Payment amount vs order total invariant (should never fire).
  const { rows: amountMismatch } = await pool.query<Row>(
    `SELECT p.payment_reference AS reference, p.external_order_id AS "externalOrderId", p.restaurant_id AS "restaurantId",
            p.amount_cents AS "amountCents", o.total_cents AS "totalCents", p.currency
       FROM marketplace_payments p
       JOIN orders o ON o.id = p.marketplace_order_id
      WHERE p.amount_cents <> o.total_cents
         OR p.currency <> 'INR'`,
  );
  amountMismatch.forEach((r) =>
    push("AMOUNT_MISMATCH", r, {
      payment_amount_cents: Number(r.amountCents),
      order_total_cents: Number(r.totalCents),
      currency: String(r.currency),
    }),
  );
  checks.amount_mismatch = amountMismatch.length;

  // 6. Provider events never linked to a payment row.
  const { rows: orphanEvents } = await pool.query<Row>(
    `SELECT COALESCE(p.payment_reference, 'unknown') AS reference,
            COALESCE(p.external_order_id, 'unknown') AS "externalOrderId",
            COALESCE(p.restaurant_id, 0) AS "restaurantId",
            e.event_id AS "eventId", e.event_type AS "eventType", e.created_at
       FROM marketplace_payment_events e
       LEFT JOIN marketplace_payments p ON p.payment_reference = e.payment_reference
      WHERE e.payment_reference IS NULL`,
  );
  orphanEvents.forEach((r) =>
    push("ORPHAN_EVENT", r, { event_id: String(r.eventId), event_type: String(r.eventType), created_at: String(r.createdAt) }),
  );
  checks.orphan_events = orphanEvents.length;

  const pass = exceptions.length === 0;

  await recordIntegrationAudit(null, "PAYMENT_RECONCILED", { actor: "system" }, {
    ran_at: ranAt.toISOString(),
    pass,
    checks,
    exceptions: exceptions.map((x) => ({ ...x, detail: x.detail })),
  });

  return { ranAt: ranAt.toISOString(), pass, checks, exceptions };
}