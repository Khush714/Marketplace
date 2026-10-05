import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { PosBridgeError, describePosTransportError, logPosTransportFailure, posHost, requirePosBaseUrl } from "@/lib/pos-bridge";

/**
 * `requirePosBaseUrl` throws a PosBridgeError; the delivery journal classifies
 * retryability off PosOrderDeliveryError, so the misconfiguration has to be
 * re-thrown in this module's error type. Retryable, because a wrong
 * POS_BASE_URL is an operator fix, not a permanently bad order — the row must
 * survive to be delivered once the URL is corrected.
 */
export function resolvePosBaseUrlForDelivery(): string {
  try {
    return requirePosBaseUrl();
  } catch (err) {
    throw new PosOrderDeliveryError(
      err instanceof Error ? err.message : "POS_BASE_URL is not configured",
      err instanceof PosBridgeError ? err.status : 503,
      "POS_UNREACHABLE",
      true,
    );
  }
}

export const POS_ORDER_INGEST_PATH = "/integrations/marketplace/orders";
const ORDER_INGEST_TIMEOUT_MS = 8000;

export interface PosOrderIngestResponse {
  success: boolean;
  duplicate: boolean;
  external_order_id: string;
  order_id: number | null;
  pos_order_id: number | null;
  status: string;
}

/**
 * Deterministic POS-side rejections the bridge must NOT retry. Everything else
 * without a 2xx (5xx, 429, timeout, connection failure) is transient.
 */
function classifyRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

export class PosOrderDeliveryError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, code: string, retryable: boolean) {
    super(message);
    this.name = "PosOrderDeliveryError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Deliver one Marketplace order to the POS order bridge. `marketplace_id` is
 * the tenant's stable external id (rst_…) carried in the payload; `secret` is
 * the shared webhook secret (the single ACTIVE integration credential). The
 * HMAC is computed over the exact raw body bytes — the same frame the POS
 * `webhooks.verifyInbound` re-derives.
 */
export async function postPosOrderIngest(opts: {
  marketplaceId: string;
  secret: string;
  payload: Record<string, unknown>;
  requestId?: string;
}): Promise<{ status: number; response: PosOrderIngestResponse }> {
  const base = resolvePosBaseUrlForDelivery();

  const rawBody = JSON.stringify(opts.payload);
  const signature = createHmac("sha256", opts.secret).update(rawBody).digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORDER_INGEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${POS_ORDER_INGEST_PATH}`, {
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
    // Logged, not swallowed: a delivery journal that only records
    // POS_UNREACHABLE cannot tell DNS failure from a refused port, and the
    // distinction decides whether ops restarts a tunnel or fixes a record.
    const { reason, detail } = describePosTransportError(err);
    logPosTransportFailure({ reason, detail, host: posHost() });
    throw new PosOrderDeliveryError("POS is unreachable", 502, "POS_UNREACHABLE", true);
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: Partial<PosOrderIngestResponse> & { error?: string }; error?: string }
    | null;

  if (res.ok && body?.success) {
    const data = body.data ?? {};
    return {
      status: res.status,
      response: {
        success: true,
        duplicate: !!data.duplicate,
        external_order_id: String(
          data.external_order_id ??
            String((opts.payload.order as { id?: string | number } | undefined)?.id ?? ""),
        ),
        order_id: data.order_id != null ? Number(data.order_id) : null,
        pos_order_id: data.pos_order_id != null ? Number(data.pos_order_id) : null,
        status: String(data.status ?? "RECEIVED"),
      },
    };
  }

  const status = res.status;
  const code =
    (typeof body?.error === "string" && body.error) ||
    (typeof body?.data?.error === "string" && body.data.error) ||
    (status === 422 ? "UNMAPPED_ITEMS" : `POS_REQUEST_FAILED_${status}`);
  throw new PosOrderDeliveryError(
    typeof body?.error === "string" ? body.error : `POS order ingest failed (${status})`,
    status,
    code,
    classifyRetryable(status),
  );
}