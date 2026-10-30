import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  applyOrderStatusTransition,
  resolveOrderTenantForPosCallback,
} from "@/db/pos-delivery";
import { handleCancelledOrderPayment } from "@/integrations/payments/refund";
import {
  CUSTOM_POS_MAX_BODY_BYTES,
  parseCustomPosCallback,
  verifyCustomPosSignature,
} from "@/integrations/pos/custom-pos-core";
import { guardBudget, readRawBodyCapped } from "@/lib/abuse";
import { openWebhookSecret } from "@/lib/webhook-crypto";

/**
 * Inbound custom-POS status callback.
 *
 * Unlike Restaurant AI and Petpooja, a custom POS is per listing, so there is no
 * process-wide secret to check the frame against. The tenant is resolved from
 * the external order id first, its sealed per-listing secret is opened, and only
 * then is the signature verified over the exact raw body:
 *
 *   X-Savour-Timestamp: <unix seconds or ISO-8601>
 *   X-Savour-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>\n<body>")>
 *
 * The security boundary is the same as the sibling callbacks:
 *
 *   1. Authenticity: a missing secret, a stale timestamp or a tampered body fails
 *      closed. Missing configuration is 401, never an open path.
 *   2. Tenancy: the tenant comes from the order id in `orders`, never from a
 *      body field. A frame naming an order owned by another provider is refused
 *      before any status write.
 *   3. State: the callback goes through `applyOrderStatusTransition`, the same
 *      event-id-deduped, forward-only path the other providers use — so a replay
 *      cannot rewrite history and CANCELLED / REJECTED fire the refund
 *      orchestration instead of just flipping a column.
 *
 * Unknown orders and provider mismatches return the same generic 401 as a bad
 * signature, so the endpoint is not an existence oracle for order ids. The
 * reason is logged server-side only.
 */

const WEBHOOK_EVENT = "custom_pos_webhook";

function ack(body: Record<string, unknown> = {}): Response {
  return Response.json({ ok: true, acknowledged: true, ...body });
}

function reject(reason: string, status = 401): Response {
  // Boring identifiers only: no body, signature, secret or address reaches the
  // log. The caller gets one generic answer so probing cannot distinguish
  // "unknown order" from "bad signature".
  console.error(JSON.stringify({ event: `${WEBHOOK_EVENT}_rejected`, reason }));
  return Response.json({ ok: false, message: "Invalid signature" }, { status });
}

export async function handleCustomPosWebhook(req: NextRequest): Promise<Response> {
  // Charged before the signature check so a flood of bad frames is bounded too.
  const throttled = guardBudget(req, "customPosWebhook");
  if (throttled) return throttled;

  const raw = await readRawBodyCapped(req, CUSTOM_POS_MAX_BODY_BYTES);
  if (!raw.ok) return raw.response;
  const rawBody = raw.text;

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, message: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseCustomPosCallback(body);
  if (parsed.kind === "ignored") {
    // Not actionable (no order id / no known status). Acknowledge before tenant
    // lookup so a provider retry loop converges instead of replaying forever.
    return ack({ ignored: true, reason: parsed.reason });
  }

  const tenant = await resolveOrderTenantForPosCallback(parsed.externalOrderId);
  if (!tenant || tenant.provider !== "custom_webhook") {
    console.error(
      JSON.stringify({
        event: `${WEBHOOK_EVENT}_ignored`,
        reason: tenant ? "PROVIDER_MISMATCH" : "ORDER_NOT_FOUND",
        external_order_id: parsed.externalOrderId,
      }),
    );
    return reject(tenant ? "provider_mismatch" : "order_not_found");
  }

  if (!tenant.sealedSecret) {
    // A custom_webhook record is provisioned with a sealed signing secret. An
    // absent one is an operator error and must deny, not open.
    return reject("signing_secret_not_configured");
  }

  let secret: string;
  try {
    secret = openWebhookSecret(tenant.sealedSecret);
  } catch {
    return reject("sealed_secret_unreadable");
  }

  const timestamp = req.headers.get("x-savour-timestamp");
  const signature = req.headers.get("x-savour-signature");
  const verification = verifyCustomPosSignature({
    rawBody,
    timestamp,
    signature,
    secret,
    nowEpochSeconds: Math.floor(Date.now() / 1000),
  });
  if (!verification.valid) {
    return reject(verification.reason.toLowerCase());
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

    // A POS-side cancellation or rejection is the money-return trigger, exactly
    // as on the other provider paths. Fire-and-forget: the webhook response must
    // not block on a provider refund call, and the orchestration is idempotent.
    if (result.outcome === "applied" && (parsed.status === "CANCELLED" || parsed.status === "REJECTED")) {
      void handleCancelledOrderPayment(
        tenant.restaurantId,
        parsed.externalOrderId,
        `CUSTOM_POS_ORDER_${parsed.status}`,
      ).catch((e) => {
        console.error("[custom-pos-webhook] refund orchestration failed", e);
      });
    }

    return ack({
      applied: result.outcome === "applied",
      status: parsed.status,
      event_id: parsed.eventId,
    });
  } catch (e) {
    // A non-2xx is what the sender treats as retryable, which is what a
    // database failure deserves. Do not include the error text: it can carry SQL.
    console.error("[custom-pos-webhook] transition failed", e);
    return Response.json({ ok: false, message: "Temporary failure" }, { status: 503 });
  }
}
