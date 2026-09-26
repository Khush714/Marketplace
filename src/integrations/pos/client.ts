import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { posBaseUrl } from "@/lib/pos-bridge";

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
  const base = posBaseUrl();
  if (!base) {
    throw new PosOrderDeliveryError("POS_BASE_URL is not configured", 503, "POS_UNREACHABLE", true);
  }

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
    });
  } catch {
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