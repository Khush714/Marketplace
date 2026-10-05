import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { PosBridgeError, describePosTransportError, logPosTransportFailure, posHost, requirePosBaseUrl } from "@/lib/pos-bridge";
import { openWebhookSecret } from "@/lib/webhook-crypto";
import { recordIntegrationAudit } from "@/db/queries";
import {
  claimPaymentDeliveryAttempt,
  enqueuePaymentDelivery as journalPaymentDelivery,
  getDuePosPaymentDeliveryIds,
  loadPosPaymentDeliveryContext,
  recordPaymentDeliveryFailure,
  recordPaymentDeliverySuccess,
  type PosPaymentDeliveryContext,
} from "@/db/payment-delivery";
import { enqueuePosDelivery, processPendingPosDeliveries } from "@/integrations/pos/order-bridge";
import { integrationReadiness } from "@/integrations/pos/readiness";

/**
 * Marketplace → POS payment bridge (Phase 6). Narrow by design: it builds the
 * HMAC-signed payment/refund webhook body for `POST /integrations/marketplace/
 * payments` and owns the delivery journal that guarantees at-least-once push.
 * It carries NO invoice / cash-drawer / refund-engineering / pricing logic —
 * the POS payment engine owns all of that (its existing pipeline books the
 * capture via completePaymentAndEnqueue).
 *
 * Ordering invariant: a payment push only fires after the ORDER reached the
 * POS (order.posOrderId set) — payment.captured resolves the POS order by
 * external_order_id, so pushing money before the order would orphan it.
 */

export const POS_PAYMENT_PATH = "/integrations/marketplace/payments";
const PAYMENT_PUSH_TIMEOUT_MS = 8000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classifyRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

export class PosPaymentDeliveryError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, code: string, retryable: boolean) {
    super(message);
    this.name = "PosPaymentDeliveryError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/* --------------------------- payload building ---------------------------- */

export interface PosPaymentBridgeEventInput {
  payment: {
    reference: string;
    providerPaymentId: string | null;
    amountCents: number;
    currency: string;
    method: string | null;
  };
  order: {
    id: number;
    externalOrderId: string | null;
    posOrderId: number | null;
    marketplaceId: string | null;
    /** Branch/outlet hints (Phase 7) — echoed so the POS books money to the
     *  same branch context the order was ingested under. */
    outletId?: string | null;
    branchId?: string | null;
  };
  eventType: "payment.captured" | "refund.initiated" | "refund.completed" | "refund.failed";
  eventId: string;
  refund?: {
    id: string;
    amountCents: number;
    totalRefundedCents: number;
    reason: string | null;
    status: "PENDING" | "COMPLETED" | "FAILED";
  };
}

/**
 * The exact body the POS `handlePaymentWebhook` accepts (contract:
 * integrations/marketplace/payments.js). `restaurant_id` is the tenant's
 * stable external id — the POS derives the restaurant from it server-side,
 * never from a client-asserted numeric id.
 */
export function buildPosPaymentPayload(input: PosPaymentBridgeEventInput): Record<string, unknown> {
  const base = {
    event: input.eventType,
    event_id: input.eventId,
    restaurant_id: input.order.marketplaceId,
    external_order_id: input.order.externalOrderId ?? `mkt_ord_${input.order.id}`,
    ...(input.order.outletId ? { outlet_id: input.order.outletId } : {}),
    ...(input.order.branchId ? { branch_id: input.order.branchId } : {}),
  };

  if (input.eventType === "payment.captured") {
    return {
      ...base,
      payment: {
        id: input.payment.providerPaymentId,
        amount: round2(input.payment.amountCents / 100),
        method: input.payment.method ?? "card",
        commission_amount: 0,
        currency: input.payment.currency,
        paid_at: new Date().toISOString(),
      },
    };
  }

  return {
    ...base,
    refund: {
      id: input.refund?.id,
      payment_id: input.payment.providerPaymentId,
      amount: round2((input.refund?.amountCents ?? 0) / 100),
      total_refunded: round2((input.refund?.totalRefundedCents ?? 0) / 100),
      reason: input.refund?.reason ?? null,
      status: input.refund?.status,
    },
  };
}

/* ----------------------------- HTTP client ------------------------------- */

/**
 * Same reason as the order client's resolver: `requirePosBaseUrl` throws a
 * PosBridgeError, but the payment journal classifies retryability off
 * PosPaymentDeliveryError. A wrong POS_BASE_URL is an operator fix, so the row
 * must stay retryable.
 */
function resolvePosBaseUrlForPayment(): string {
  try {
    return requirePosBaseUrl();
  } catch (err) {
    throw new PosPaymentDeliveryError(
      err instanceof Error ? err.message : "POS_BASE_URL is not configured",
      err instanceof PosBridgeError ? err.status : 503,
      "POS_UNREACHABLE",
      true,
    );
  }
}

export async function postPosPaymentEvent(opts: {
  marketplaceId: string;
  secret: string;
  payload: Record<string, unknown>;
  requestId?: string;
}): Promise<{ status: number; response: { success?: boolean; handled?: boolean; dedup?: boolean } }> {
  const base = resolvePosBaseUrlForPayment();

  const rawBody = JSON.stringify(opts.payload);
  const signature = createHmac("sha256", opts.secret).update(rawBody).digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAYMENT_PUSH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${POS_PAYMENT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-marketplace-signature": signature,
        "x-request-id": opts.requestId ?? randomUUID(),
      },
      body: rawBody,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const { reason, detail } = describePosTransportError(err);
    logPosTransportFailure({ reason, detail, host: posHost() });
    throw new PosPaymentDeliveryError("POS is unreachable", 502, "POS_UNREACHABLE", true);
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; handled?: boolean; dedup?: boolean; error?: string; data?: { error?: string } }
    | null;

  if (res.ok && body?.success) {
    return { status: res.status, response: body };
  }

  const status = res.status;
  const error =
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.data?.error === "string" && body.data.error) ||
    `POS payment push failed (${status})`;
  const code = typeof body?.error === "string" ? body.error : `POS_PAYMENT_REQUEST_FAILED_${status}`;
  throw new PosPaymentDeliveryError(error, status, code, classifyRetryable(status));
}

/* --------------------- delivery journal + worker ------------------------- */

export type PaymentDeliveryOutcome = "delivered" | "terminal_failed" | "retry_scheduled" | "skipped";

/** Skip silently when the restaurant has no ACTIVE integration. */
export async function enqueuePaymentDelivery(input: {
  paymentId: number;
  externalOrderId: string;
  restaurantId: number;
  eventType: PosPaymentBridgeEventInput["eventType"];
  eventId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  let deliveryId: number | null = null;
  try {
    deliveryId = await journalPaymentDelivery(input);
  } catch (e) {
    console.error("[pos-payment-delivery] enqueue failed", e);
    return;
  }
  if (deliveryId == null) return;
  void attemptPaymentDelivery(deliveryId).catch(() => {
    // The row stays PENDING and the drain loop owns the retry.
  });
}

/**
 * Same rule as the order bridge and `hasActiveIntegration`, delegated so the
 * three cannot drift — the wording is the operator-facing form of each reason.
 */
function notReadyReason(ctx: PosPaymentDeliveryContext): string | null {
  const { notReadyReason: reason } = integrationReadiness({
    status: ctx.marketplaceId && ctx.integrationActive ? "active" : "pending",
    posRestaurantId: ctx.marketplaceId,
    webhookSecret: ctx.sealedSecret,
  });
  if (!reason) return null;
  if (reason === "inactive") return ctx.marketplaceId ? "integration not active" : "integration not claimed";
  return "webhook secret missing";
}

/**
 * Deliver one journaled payment event to the POS. The attempt is claimed
 * atomically (SKIP LOCKED + claim UPDATE) so concurrent drains never double
 * POST — and even a racing send is safe because the bridge event_id is stable
 * and the POS webhook_events ledger dedupes it.
 */
export async function attemptPaymentDelivery(deliveryId: number): Promise<PaymentDeliveryOutcome> {
  const ctx = await loadPosPaymentDeliveryContext(deliveryId);
  if (!ctx) return "skipped";

  const notReady = notReadyReason(ctx);
  if (notReady) {
    const terminal = await recordPaymentDeliveryFailure(deliveryId, notReady, true, 0);
    return terminal ? "terminal_failed" : "retry_scheduled";
  }

  // ORDER before MONEY: wait for the order to reach the POS (posOrderId set),
  // and converge to terminal FAILED if the order itself was rejected.
  const orderPosId = ctx.order.posOrderId;
  const orderDeliveryStatus = ctx.order.posDeliveryStatus;
  if (orderPosId == null) {
    if (orderDeliveryStatus === "FAILED") {
      await recordPaymentDeliveryFailure(deliveryId, "order delivery to POS failed; payment push skipped", false, 0);
      await recordIntegrationAudit(ctx.order.restaurantId, "PAYMENT_DELIVERED_TO_POS", { actor: "system" }, {
        event_id: ctx.delivery.eventId,
        external_order_id: ctx.order.externalOrderId,
        status: "SKIPPED_ORDER_NOT_AT_POS",
      });
      return "terminal_failed";
    }
    const claimed = await claimPaymentDeliveryAttempt(deliveryId);
    if (!claimed) return "skipped";
    const terminal = await recordPaymentDeliveryFailure(deliveryId, "order not yet at POS; waiting", true, claimed.attempts);
    return terminal ? "terminal_failed" : "retry_scheduled";
  }

  const claimed = await claimPaymentDeliveryAttempt(deliveryId);
  if (!claimed) return "skipped";

  let secret: string;
  try {
    secret = openWebhookSecret(ctx.sealedSecret!);
  } catch {
    const terminal = await recordPaymentDeliveryFailure(deliveryId, "sealed webhook secret could not be opened", true, claimed.attempts);
    return terminal ? "terminal_failed" : "retry_scheduled";
  }

  try {
    const payload = buildPosPaymentPayload({
      payment: {
        reference: ctx.payment.reference,
        providerPaymentId: ctx.payment.providerPaymentId,
        amountCents: ctx.payment.amountCents,
        currency: ctx.payment.currency,
        method: ctx.payment.method,
      },
      order: {
        id: ctx.order.id,
        externalOrderId: ctx.order.externalOrderId,
        posOrderId: orderPosId,
        marketplaceId: ctx.marketplaceId,
        outletId: ctx.posOutletId,
        branchId: ctx.posBranchId,
      },
      eventType: ctx.delivery.eventType as PosPaymentBridgeEventInput["eventType"],
      eventId: ctx.delivery.eventId,
      refund: ctx.delivery.payload.refund as PosPaymentBridgeEventInput["refund"] | undefined,
    });
    await postPosPaymentEvent({
      marketplaceId: ctx.marketplaceId!,
      secret,
      payload,
    });
    await recordPaymentDeliverySuccess(deliveryId);
    await recordIntegrationAudit(ctx.order.restaurantId, "PAYMENT_DELIVERED_TO_POS", { actor: "system" }, {
      event_id: ctx.delivery.eventId,
      external_order_id: ctx.order.externalOrderId,
      payment_reference: ctx.payment.reference,
      event_type: ctx.delivery.eventType,
      status: "DELIVERED",
    });
    return "delivered";
  } catch (e) {
    const err = e instanceof PosPaymentDeliveryError ? e : null;
    const retryable = err ? err.retryable : true;
    const terminal = await recordPaymentDeliveryFailure(
      deliveryId,
      (err ? err.message : String(e)).slice(0, 2000),
      retryable,
      claimed.attempts,
    );
    return terminal ? "terminal_failed" : "retry_scheduled";
  }
}

export interface PaymentDeliveryDrainSummary {
  processed: number;
  delivered: number;
  retryScheduled: number;
  terminalFailed: number;
  skipped: number;
}

/**
 * Drain every due PENDING payment journal row. Called from the instrumentation
 * loop (after the order drain) and by the ops endpoint, exactly-once per row
 * per pass.
 */
export async function processPendingPaymentDeliveries(limit = 20): Promise<PaymentDeliveryDrainSummary> {
  const ids = await getDuePosPaymentDeliveryIds(limit);
  const summary: PaymentDeliveryDrainSummary = {
    processed: ids.length,
    delivered: 0,
    retryScheduled: 0,
    terminalFailed: 0,
    skipped: 0,
  };
  for (const id of ids) {
    try {
      const outcome = await attemptPaymentDelivery(id);
      if (outcome === "delivered") summary.delivered++;
      else if (outcome === "retry_scheduled") summary.retryScheduled++;
      else if (outcome === "terminal_failed") summary.terminalFailed++;
      else summary.skipped++;
    } catch (e) {
      summary.retryScheduled++;
      console.error(`[pos-payment-delivery] unexpected error draining #${id}`, e);
    }
  }
  return summary;
}

/**
 * On a verified capture: make sure the ORDER is enqueued to the POS first
 * (idempotent — the order journal dedupes on marketplace_order_id) and the
 * payment.captured delivery follows; the payment worker waits for posOrderId.
 */
export async function coordinateCaptureDelivery(payment: {
  id: number;
  orderId: number;
  reference: string;
  externalOrderId: string;
  restaurantId: number;
  providerPaymentId: string | null;
  amountCents: number;
  currency: string;
  method: string | null;
}): Promise<void> {
  await enqueuePosDelivery(payment.orderId).catch(() => {});
  await enqueuePaymentDelivery({
    paymentId: payment.id,
    externalOrderId: payment.externalOrderId,
    restaurantId: payment.restaurantId,
    eventType: "payment.captured",
    eventId: `${payment.reference}:payment.captured`,
    payload: {},
  }).catch(() => {});
  const summary = await processPendingPaymentDeliveries(20);
  console.log(`[pos-payment] capture delivery pass for ${payment.reference}: ${JSON.stringify(summary)}`);
}