import "server-only";

import { PosOrderDeliveryError } from "@/integrations/pos/client";
import {
  parsePetpoojaPushResponse,
  type PetpoojaPushPayload,
} from "@/integrations/pos/petpooja-core";
import {
  describePosTransportError,
  logPosTransportFailure,
} from "@/lib/pos-bridge";

/**
 * Petpooja push client.
 *
 * This is the HTTP half of the Petpooja provider adapter; the contract lives in
 * `petpooja-core.ts`. It is called only from `attemptPosDelivery`, after the
 * delivery journal row exists, so a timeout here leaves a PENDING row for the
 * drain to retry rather than losing the order.
 *
 * Credentials are partner-level (one app key/secret for every restaurant this
 * Marketplace serves), unlike the Restaurant AI bridge's per-restaurant sealed
 * webhook secret. The per-restaurant half is `restID`, stored in
 * `integration_records.pos_restaurant_id`. That split is why this module reads
 * env while the order payload takes `restId` as an argument: it keeps the
 * tenant identity out of process-wide configuration.
 *
 * The pasted Petpooja contract is unverified. `PETPOOJA_API_URL` exists so the
 * endpoint can be corrected without a code change, and every failure is
 * classified as retryable or terminal so a bad contract does not silently
 * retry forever.
 */

const DEFAULT_ENDPOINT = "https://open.petpooja.com/orders/v1/push";
const PUSH_TIMEOUT_MS = 8000;

function petpoojaEnv(): { appKey: string; appSecret: string; endpoint: string } {
  return {
    appKey: (process.env.PETPOOJA_APP_KEY ?? "").trim(),
    appSecret: (process.env.PETPOOJA_APP_SECRET ?? "").trim(),
    endpoint: (process.env.PETPOOJA_API_URL ?? "").trim() || DEFAULT_ENDPOINT,
  };
}

/** Are the partner credentials present? Read by the readiness gate. */
export function petpoojaConfigured(): boolean {
  const { appKey, appSecret } = petpoojaEnv();
  return !!appKey && !!appSecret;
}

function hostOf(endpoint: string): string | null {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
}

/**
 * Push one order to Petpooja. Returns the POS order id when the provider echoes
 * one; throws `PosOrderDeliveryError` otherwise so the journal can decide
 * whether to retry.
 */
export async function pushPetpoojaOrder(
  payload: PetpoojaPushPayload,
): Promise<{ posOrderId: number | null }> {
  const { appKey, appSecret, endpoint } = petpoojaEnv();
  if (!appKey || !appSecret) {
    // Retryable: this is an operator fix. The journal row must survive until
    // the credentials land, exactly like a missing POS_BASE_URL.
    throw new PosOrderDeliveryError(
      "Petpooja credentials are not configured",
      503,
      "PETPOOJA_NOT_CONFIGURED",
      true,
    );
  }

  const body = JSON.stringify({
    app_key: appKey,
    app_secret: appSecret,
    ...payload,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const { reason, detail } = describePosTransportError(err);
    logPosTransportFailure({ reason, detail, host: hostOf(endpoint) });
    throw new PosOrderDeliveryError("Petpooja is unreachable", 502, "PETPOOJA_UNREACHABLE", true);
  } finally {
    clearTimeout(timer);
  }

  const data = (await res.json().catch(() => null)) as unknown;
  const parsed = parsePetpoojaPushResponse(data);

  if (res.ok && parsed.ok) {
    return { posOrderId: parsed.posOrderId };
  }

  // 5xx and 429 are transient; every other non-success (including a 200 with
  // success:"0", which is how this contract reports a rejected order) is
  // deterministic and must not be retried forever.
  const retryable = res.status >= 500 || res.status === 429;
  throw new PosOrderDeliveryError(
    parsed.error ?? `Petpooja order push failed (${res.status})`,
    res.status,
    res.status === 422 ? "PETPOOJA_UNMAPPED_ITEMS" : `PETPOOJA_REQUEST_FAILED_${res.status}`,
    retryable,
  );
}
