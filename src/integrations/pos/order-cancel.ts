import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { loadOrderCancelContext, recordIntegrationAudit } from "@/db/queries";
import { describePosTransportError, logPosTransportFailure, posBaseUrl, posBaseUrlProblem, posHost } from "@/lib/pos-bridge";
import { openWebhookSecret } from "@/lib/webhook-crypto";

/**
 * Customer-initiated cancellation
 * ---------------------------------
 * The POS is the authority (§20–23). This module only:
 *   1. checks the order is actually cancellable (not a terminal, has a POS);
 *   2. signs & forwards an `order.cancelled` request to the POS
 *      `/integrations/marketplace/order-cancel` (same three-token contract as
 *      order ingest);
 *   3. interprets the POS's EXPLICIT response — never a bare HTTP 200.
 *
 * The Marketplace NEVER flips orders.integration_status here: the POS re-pushes
 * an authoritative `order.cancelled` status webhook (delivered through the
 * Phase 3 outbox with {@code event_id} dedupe), and that webhook is what moves
 * the order to CANCELLED. Replays of this request hit the POS's own
 * idempotent already-cancelled path.
 */

export const POS_ORDER_CANCEL_PATH = "/integrations/marketplace/order-cancel";
const CANCEL_TIMEOUT_MS = 8000;

export type CustomerCancelOutcome =
  | { kind: "cancelled"; ok: true; idempotent: boolean; status: "CANCELLED" }
  | { kind: "pending"; ok: true; status: "PENDING" }
  | { kind: "error"; ok: false; code: string; currentStatus: string | null; reason: string };

const CANCEL_REASON = "CUSTOMER_REQUEST";

export async function requestCustomerCancellation(code: string): Promise<CustomerCancelOutcome> {
  const ctx = await loadOrderCancelContext(code);
  if (!ctx) {
    return { kind: "error", ok: false, code: "ORDER_NOT_FOUND", currentStatus: null, reason: "Order not found" };
  }

  // Idempotent end-state: already cancelled → nothing to do.
  if (ctx.integrationStatus === "CANCELLED") {
    return { kind: "cancelled", ok: true, idempotent: true, status: "CANCELLED" };
  }
  if (ctx.integrationStatus === "REJECTED" || ctx.integrationStatus === "COMPLETED") {
    return {
      kind: "error",
      ok: false,
      code: "ORDER_TERMINAL",
      currentStatus: ctx.integrationStatus,
      reason: "This order is already settled and can no longer be cancelled",
    };
  }

  if (!ctx.externalOrderId || !ctx.integrationActive || !ctx.marketplaceId || !ctx.sealedSecret) {
    return {
      kind: "error",
      ok: false,
      code: "CANCEL_UNAVAILABLE",
      currentStatus: ctx.integrationStatus,
      reason: "This order is not connected to a live POS — cancellation is unavailable",
    };
  }

  let secret: string;
  try {
    secret = openWebhookSecret(ctx.sealedSecret);
  } catch {
    return {
      kind: "error",
      ok: false,
      code: "CANCEL_UNAVAILABLE",
      currentStatus: ctx.integrationStatus,
      reason: "Cancellation is temporarily unavailable — please try again shortly",
    };
  }

  const payload = {
    event: "order.cancelled",
    external_order_id: ctx.externalOrderId,
    restaurant_id: ctx.marketplaceId,
    reason: CANCEL_REASON,
    requested_at: new Date().toISOString(),
  };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  const baseProblem = posBaseUrlProblem();
  if (baseProblem) {
    // Same misconfiguration the other three clients refuse. Logged rather than
    // swallowed: this branch previously returned POS_UNREACHABLE with nothing in
    // the logs, which is how a dead POS_BASE_URL stayed invisible.
    logPosTransportFailure(baseProblem);
    return { kind: "error", ok: false, code: "POS_UNREACHABLE", currentStatus: ctx.integrationStatus, reason: "Cancellation is temporarily unavailable" };
  }
  const base = posBaseUrl();

  await recordIntegrationAudit(ctx.restaurantId, "ORDER_CANCEL_REQUESTED", { actor: "system" }, {
    external_order_id: ctx.externalOrderId,
    pos_order_id: ctx.posOrderId,
    reason: CANCEL_REASON,
    current_status: ctx.integrationStatus,
  });

  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CANCEL_TIMEOUT_MS);
  try {
    res = await fetch(`${base}${POS_ORDER_CANCEL_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-marketplace-signature": signature,
        "x-request-id": randomUUID(),
      },
      body: rawBody,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    // Logged: "POS is unreachable" with no cause is how a dead POS_BASE_URL
    // stayed invisible in production for a whole deployment cycle.
    const { reason, detail } = describePosTransportError(err);
    logPosTransportFailure({ reason, detail, host: posHost() });
    return {
      kind: "error",
      ok: false,
      code: "POS_UNREACHABLE",
      currentStatus: ctx.integrationStatus,
      reason: "Cancellation is temporarily unavailable — please try again shortly",
    };
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => null)) as
    | {
        success?: boolean;
        error?: string;
        data?: {
          status?: string;
          error?: string;
          current_status?: string;
          reason?: string;
          previous_status?: string;
          idempotent?: boolean;
        };
      }
    | null;
  const data = body?.data ?? {};

  if (!res.ok) {
    const code =
      (typeof body?.data?.error === "string" && body.data.error) ||
      (typeof body?.error === "string" && body.error) ||
      `POS_CANCEL_FAILED_${res.status}`;
    await recordIntegrationAudit(ctx.restaurantId, "ORDER_CANCEL_REJECTED", { actor: "system" }, {
      external_order_id: ctx.externalOrderId,
      pos_order_id: ctx.posOrderId,
      reason: CANCEL_REASON,
      current_status: ctx.integrationStatus,
      error: code,
    });
    return {
      kind: "error",
      ok: false,
      code,
      currentStatus: data.current_status ?? ctx.integrationStatus,
      reason: data.reason ?? "The restaurant can no longer accept this cancellation",
    };
  }

  // Positive response must EXPLICITLY name the confirmation status.
  if (body?.success === true) {
    if (data.status === "Cancelled") {
      await recordIntegrationAudit(ctx.restaurantId, "ORDER_CANCEL_ACCEPTED", { actor: "system" }, {
        external_order_id: ctx.externalOrderId,
        pos_order_id: ctx.posOrderId,
        reason: CANCEL_REASON,
        previous_status: data.previous_status ?? ctx.integrationStatus,
        idempotent: data.idempotent === true,
        // The authoritative CANCELLED state arrives via the status webhook.
        status_update_deferred_to_webhook: true,
      });
      return {
        kind: "cancelled",
        ok: true,
        idempotent: data.idempotent === true,
        status: "CANCELLED",
      };
    }
    if (data.status === "PENDING") {
      // POS is offline and journaled the request; it reconciles on reconnect
      // and pushes CANCELLED via the webhook outbox.
      return { kind: "pending", ok: true, status: "PENDING" };
    }
  }

  await recordIntegrationAudit(ctx.restaurantId, "ORDER_CANCEL_REJECTED", { actor: "system" }, {
    external_order_id: ctx.externalOrderId,
    pos_order_id: ctx.posOrderId,
    reason: CANCEL_REASON,
    current_status: ctx.integrationStatus,
    error: "UNKNOWN_POS_RESPONSE",
    status: data.status ?? null,
  });
  return {
    kind: "error",
    ok: false,
    code: "UNKNOWN_POS_RESPONSE",
    currentStatus: ctx.integrationStatus,
    reason: "The restaurant returned an unexpected response — please refresh",
  };
}