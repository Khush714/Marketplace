import "server-only";

import { PosOrderDeliveryError } from "@/integrations/pos/client";
import {
  computeCustomPosSignature,
  customPosErrorMessage,
  customPosResponseRejected,
  parseCustomPosOrderId,
  type CustomPosOrderPayload,
} from "@/integrations/pos/custom-pos-core";
import {
  describePosTransportError,
  logPosTransportFailure,
} from "@/lib/pos-bridge";

/**
 * Custom cloud POS push client.
 *
 * The HTTP half of the `custom_webhook` adapter; the contract lives in
 * `custom-pos-core.ts`. Called only from `attemptPosDelivery`, after the
 * delivery journal row exists, so a timeout here leaves a PENDING row for the
 * drain to retry rather than losing the order.
 *
 * Every frame is signed over the exact serialized body:
 *
 *   X-Savour-Timestamp: <unix seconds>
 *   X-Savour-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>\n<body>")>
 *
 * The timestamp header is what makes the signature replay-resistant: the
 * counterparty rejects frames outside the five-minute window, and we sign the
 * same canonical frame they verify. The secret is per-listing and sealed at
 * rest; nothing here reads process-wide credentials, so one tenant's POS cannot
 * authenticate as another's.
 *
 * Failures are classified like every other provider: 5xx and 429 are
 * transient, everything else (including a 2xx whose body says `ok: false`)
 * is deterministic and must not retry forever.
 */

const PUSH_TIMEOUT_MS = 6000;

export const CUSTOM_POS_SIGNATURE_HEADER = "X-Savour-Signature";
export const CUSTOM_POS_TIMESTAMP_HEADER = "X-Savour-Timestamp";

function hostOf(endpoint: string): string | null {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
}

/**
 * Push one order to the listing's custom POS. Returns the POS order id when the
 * provider echoes one; throws `PosOrderDeliveryError` otherwise so the journal
 * can decide whether to retry.
 *
 * Only the destination host is logged on a transport failure — never the body,
 * the signature, or the signing secret. The body carries the customer's name,
 * phone and address, which must not end up in an error line.
 */
export async function pushCustomPosOrder(opts: {
  url: string;
  secret: string;
  payload: CustomPosOrderPayload;
}): Promise<{ posOrderId: number | null }> {
  if (!opts.secret) {
    // Retryable: the onboarding call stores a secret in the same transaction as
    // the URL, so a record without one is an operator fix, not a bad order.
    throw new PosOrderDeliveryError(
      "Custom POS signing secret is not configured",
      503,
      "CUSTOM_POS_NOT_CONFIGURED",
      true,
    );
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(opts.payload);
  const signature = computeCustomPosSignature(body, timestamp, opts.secret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        [CUSTOM_POS_TIMESTAMP_HEADER]: timestamp,
        [CUSTOM_POS_SIGNATURE_HEADER]: signature,
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const { reason, detail } = describePosTransportError(err);
    logPosTransportFailure({ reason, detail, host: hostOf(opts.url) });
    throw new PosOrderDeliveryError("Custom POS is unreachable", 502, "CUSTOM_POS_UNREACHABLE", true);
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => null)) as unknown;

  // A 2xx body is allowed to say "not accepted" (`ok:false` / `success:false`).
  // Treat that as a deterministic rejection rather than retrying a frame the
  // provider has already understood and refused.
  const rejected = customPosResponseRejected(data);
  if (res.ok && !rejected.rejected) {
    return { posOrderId: parseCustomPosOrderId(data) };
  }

  const retryable = res.status >= 500 || res.status === 429;
  throw new PosOrderDeliveryError(
    customPosErrorMessage(data) ??
      rejected.message ??
      `Custom POS order push failed (${res.status})`,
    res.status,
    res.status === 422 ? "CUSTOM_POS_UNMAPPED_ITEMS" : `CUSTOM_POS_REQUEST_FAILED_${res.status}`,
    retryable,
  );
}
