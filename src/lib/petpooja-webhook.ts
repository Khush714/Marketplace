import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  applyOrderStatusTransition,
  resolveOrderTenantForPosCallback,
} from "@/db/pos-delivery";
import { handleCancelledOrderPayment } from "@/integrations/payments/refund";
import {
  parsePetpoojaCallback,
  petpoojaTimestampValid,
} from "@/integrations/pos/petpooja-core";
import { guardBudget, readRawBodyCapped } from "@/lib/abuse";
import { webhookSignaturesEqual } from "@/lib/webhook-crypto";

/**
 * Inbound Petpooja status callback.
 *
 * The pasted snippet was an unauthenticated route that updated `orders.status`
 * by `orderNumber`. That is unsafe on three axes this handler closes:
 *
 *   1. Authenticity: every frame must carry an HMAC over the exact raw body and
 *      a fresh timestamp. Missing config fails closed (401), never open.
 *   2. Tenancy: the order id is resolved to its restaurant through
 *      `integration_records`, and a frame naming an order owned by another
 *      provider is acknowledged without mutation.
 *   3. State: the callback goes through `applyOrderStatusTransition`, the same
 *      forward-only, event-id-deduped path the Restaurant AI webhooks use — so a
 *      replay cannot rewrite history and a CANCELLED frame fires the refund
 *      orchestration instead of just flipping a column.
 *
 * Petpooja's snippet sends no event id. The ledger id is derived from
 * `(orderID, event_type, status)`, which is stable for a replay and distinct for
 * each real transition.
 *
 * Signature frame (unverified provider contract, documented in .env.example):
 *   x-petpooja-timestamp: ISO-8601 or Unix seconds/milliseconds
 *   x-petpooja-signature: hex HMAC-SHA256(secret, "<timestamp>\n<raw body>")
 */

const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

function ack(body: Record<string, unknown> = {}): Response {
  return Response.json({ success: "1", message: "Acknowledged", ...body });
}

function reject(reason: string, message: string, status: number): Response {
  // Boring identifiers only: no body, signature, or secret reaches the log.
  console.error(JSON.stringify({ event: "petpooja_webhook_rejected", reason }));
  return Response.json({ success: "0", message }, { status });
}

function normalizeSignature(raw: string): string {
  const trimmed = raw.trim();
  const withoutPrefix = /^sha256=/i.test(trimmed) ? trimmed.slice(7) : trimmed;
  return withoutPrefix.trim().toLowerCase();
}

export async function handlePetpoojaWebhook(req: NextRequest): Promise<Response> {
  // Charged before the signature check so a flood of bad frames is bounded too.
  const throttled = guardBudget(req, "petpoojaWebhook");
  if (throttled) return throttled;

  const raw = await readRawBodyCapped(req, WEBHOOK_MAX_BODY_BYTES);
  if (!raw.ok) return raw.response;
  const rawBody = raw.text;

  const secret = (process.env.PETPOOJA_WEBHOOK_SECRET ?? "").trim();
  const timestamp = (req.headers.get("x-petpooja-timestamp") ?? "").trim();
  const signature = normalizeSignature(req.headers.get("x-petpooja-signature") ?? "");

  if (!secret) {
    // Fail closed. An unset secret is an operator error, not a reason to accept
    // unauthenticated status writes.
    return reject("webhook_secret_not_configured", "Invalid signature", 401);
  }
  if (!signature || !petpoojaTimestampValid(timestamp)) {
    return reject("invalid_timestamp_or_signature", "Invalid signature", 401);
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}\n${rawBody}`)
    .digest("hex");
  if (!webhookSignaturesEqual(signature, expected)) {
    return reject("invalid_signature", "Invalid signature", 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ success: "0", message: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parsePetpoojaCallback(body);
  if (parsed.kind === "ignored") {
    // Verified but not actionable: acknowledge so the sender converges instead
    // of retrying an event we will never apply.
    return ack({ ignored: true, reason: parsed.reason });
  }

  const tenant = await resolveOrderTenantForPosCallback(parsed.externalOrderId);
  if (!tenant || tenant.provider !== "petpooja") {
    console.error(
      JSON.stringify({
        event: "petpooja_webhook_ignored",
        reason: tenant ? "PROVIDER_MISMATCH" : "ORDER_NOT_FOUND",
        external_order_id: parsed.externalOrderId,
      }),
    );
    return ack({ ignored: true, reason: tenant ? "PROVIDER_MISMATCH" : "ORDER_NOT_FOUND" });
  }

  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  try {
    const result = await applyOrderStatusTransition({
      restaurantId: tenant.restaurantId,
      eventId: parsed.eventId,
      externalOrderId: parsed.externalOrderId,
      posOrderId: null,
      status: parsed.status,
      payloadHash,
    });

    // A POS-side cancellation is the money-return trigger, exactly as on the
    // Restaurant AI path. Fire-and-forget: the webhook response must not block
    // on a provider refund call, and the orchestration is idempotent.
    if (result.outcome === "applied" && parsed.status === "CANCELLED") {
      void handleCancelledOrderPayment(
        tenant.restaurantId,
        parsed.externalOrderId,
        "PETPOOJA_ORDER_CANCELLED",
      ).catch((e) => {
        console.error("[petpooja-webhook] refund orchestration failed", e);
      });
    }

    return ack({
      applied: result.outcome === "applied",
      status: parsed.status,
      event_id: parsed.eventId,
    });
  } catch (e) {
    // The sender treats a non-2xx as retryable, which is what a database
    // failure deserves. Do not include the error text: it can carry SQL.
    console.error("[petpooja-webhook] transition failed", e);
    return Response.json(
      { success: "0", message: "Temporary failure" },
      { status: 503 },
    );
  }
}
