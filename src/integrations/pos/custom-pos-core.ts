/**
 * Custom cloud POS webhook contract, as pure functions.
 *
 * `custom_webhook` is the third provider behind the durable delivery journal in
 * `order-bridge.ts`. Unlike Restaurant AI (per-tenant sealed secret) and
 * Petpooja (partner-level app credentials), a custom POS is identified by a
 * per-listing HTTPS endpoint plus a per-listing signing secret. That keeps the
 * wire contract isolated: no passkey rotation, no claim-code redemption, no
 * partner app key.
 *
 * No `server-only` here on purpose, matching `petpooja-core.ts`: the order
 * bridge and `node --test` both import it, so the payload shape, signature
 * rules, replay window and status vocabulary are testable without a database or
 * a network.
 *
 * Money is integer paise inside the Marketplace. The rupee strings produced here
 * are a wire encoding only, built with integer arithmetic in
 * `formatCentsAsRupees`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { orderItemLineTotalCents, type OrderRow } from "@/db/schema";
import type { MarketplaceOrderStatus } from "@/integrations/pos/order-status";
import { isOnlinePaymentMethod, posItemName } from "@/integrations/pos/order-payload-shape";
import { isPrivateOrReservedHost } from "@/lib/image-policy";
import { formatCentsAsRupees } from "@/integrations/pos/petpooja-core";

export const CUSTOM_POS_HEADER_SIGNATURE = "x-savour-signature";
export const CUSTOM_POS_HEADER_TIMESTAMP = "x-savour-timestamp";
export const CUSTOM_POS_MAX_REPLAY_SECONDS = 300;
export const CUSTOM_POS_MAX_BODY_BYTES = 256 * 1024;
const MAX_WEBHOOK_URL_LENGTH = 2048;

/* ------------------------------- payload -------------------------------- */

export interface CustomPosOrderItem {
  id: string;
  name: string;
  quantity: number;
  pricePaise: number;
  priceFormatted: string;
}

export interface CustomPosOrderPayload {
  event: "order.created";
  /** Stable external id (`mkt_ord_<id>`) — the idempotency key on the POS. */
  orderId: string;
  /** Customer-facing order code, for the kitchen ticket. */
  orderNumber: string;
  restaurantId: number;
  restaurantSlug: string;
  restaurantMarketplaceId: string | null;
  orderType: "delivery";
  createdAt: string;
  customer: {
    name: string;
    phone: string;
    address: string;
    addressLabel: string;
    instructions: string;
  };
  items: CustomPosOrderItem[];
  totals: {
    subtotalPaise: number;
    deliveryFeePaise: number;
    platformFeePaise: number;
    discountPaise: number;
    grandTotalPaise: number;
    grandTotalFormatted: string;
  };
  /**
   * Mirrors the Restaurant AI payload's payment vocabulary: an online order is
   * only ever sent after capture (the bridge's money gate), so `PAID` is true;
   * a COD order rides `COD` with the amount due at the door.
   */
  payment: {
    status: "PAID" | "COD";
    method: string;
  };
}

/**
 * Build the exact `order.created` frame a custom POS receives.
 *
 * `orderId` is the caller-supplied stable external id rather than a value
 * derived here, so the outbound id and the inbound callback id can never drift.
 * Item names fold modifier selections in (`posItemName`), because the wire shape
 * has no modifier columns and a bare name would print an incomplete ticket.
 */
export function buildCustomPosPayload(
  order: Pick<
    OrderRow,
    | "id"
    | "code"
    | "restaurantId"
    | "restaurantSlug"
    | "createdAt"
    | "items"
    | "customerName"
    | "phone"
    | "addressText"
    | "addressLabel"
    | "instructions"
    | "subtotalCents"
    | "deliveryFeeCents"
    | "platformFeeCents"
    | "discountCents"
    | "totalCents"
    | "paymentMethod"
  >,
  opts: { externalOrderId: string; marketplaceId?: string | null },
): CustomPosOrderPayload {
  const items = order.items.map((item) => {
    const quantity = Math.max(1, Math.floor(item.quantity) || 1);
    const lineTotalCents = orderItemLineTotalCents(item);
    // Same rule as the other providers: the unit price is the effective all-in
    // per-unit amount, so price × quantity reproduces the line total billed.
    const unitCents = Math.round(lineTotalCents / quantity);
    return {
      id: String(item.menuItemId),
      name: posItemName(item),
      quantity,
      pricePaise: unitCents,
      priceFormatted: formatCentsAsRupees(unitCents),
    };
  });

  return {
    event: "order.created",
    orderId: opts.externalOrderId,
    orderNumber: order.code,
    restaurantId: order.restaurantId,
    restaurantSlug: order.restaurantSlug,
    restaurantMarketplaceId: opts.marketplaceId ?? null,
    orderType: "delivery",
    createdAt: new Date(order.createdAt).toISOString(),
    customer: {
      name: order.customerName,
      phone: order.phone,
      address: order.addressText,
      addressLabel: order.addressLabel,
      instructions: order.instructions,
    },
    items,
    totals: {
      subtotalPaise: order.subtotalCents,
      deliveryFeePaise: order.deliveryFeeCents,
      platformFeePaise: order.platformFeeCents,
      discountPaise: order.discountCents,
      grandTotalPaise: order.totalCents,
      grandTotalFormatted: formatCentsAsRupees(order.totalCents),
    },
    payment: {
      status: isOnlinePaymentMethod(order.paymentMethod) ? "PAID" : "COD",
      method: order.paymentMethod,
    },
  };
}

/* ------------------------------ signatures ------------------------------- */

/**
 * Sign the exact raw body bytes. The frame is the one the inbound handler
 * verifies: `HMAC-SHA256(secret, "<timestamp>\n<raw body>")`, hex, with a
 * `sha256=` scheme prefix so the header is self-describing.
 */
export function computeCustomPosSignature(
  rawBody: string,
  timestamp: string | number,
  secret: string,
): string {
  const hex = createHmac("sha256", secret.trim())
    .update(`${timestamp}\n${rawBody}`, "utf8")
    .digest("hex");
  return `sha256=${hex}`;
}

/** Strip an optional `sha256=` prefix and normalise casing for comparison. */
export function normalizeCustomPosSignature(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  const withoutPrefix = /^sha256=/i.test(trimmed) ? trimmed.slice(7) : trimmed;
  return withoutPrefix.trim().toLowerCase();
}

/**
 * Parse a Unix-seconds or Unix-milliseconds timestamp into epoch seconds.
 * ISO-8601 is accepted too, matching the sibling provider, because a
 * well-formed clock value is more useful than a provider-specific spelling.
 */
export function customPosTimestampSeconds(raw: string): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    // 13+ digits is milliseconds; 10 digits is seconds. The boundary is
    // generous enough for both spellings without guessing at a 12-digit value.
    return trimmed.length >= 13 ? Math.floor(n / 1000) : n;
  }

  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export type CustomPosVerificationReason =
  | "MISSING_CREDENTIALS"
  | "INVALID_TIMESTAMP"
  | "TIMESTAMP_OUT_OF_WINDOW"
  | "SIGNATURE_MISMATCH";

export type CustomPosVerification =
  | { valid: true }
  | { valid: false; reason: CustomPosVerificationReason };

/**
 * Verify an inbound callback. Missing config, an unparseable or stale
 * timestamp, and a tampered body all fail closed. Comparison is constant-time
 * over the decoded digests; a non-hex or truncated header simply fails the
 * length check.
 */
export function verifyCustomPosSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowEpochSeconds?: number;
}): CustomPosVerification {
  const { rawBody, timestamp, signature, secret } = input;
  if (!timestamp || !signature || !secret) {
    return { valid: false, reason: "MISSING_CREDENTIALS" };
  }

  const timestampSeconds = customPosTimestampSeconds(timestamp);
  if (timestampSeconds == null) {
    return { valid: false, reason: "INVALID_TIMESTAMP" };
  }

  const now = input.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > CUSTOM_POS_MAX_REPLAY_SECONDS) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_WINDOW" };
  }

  const expected = Buffer.from(
    normalizeCustomPosSignature(computeCustomPosSignature(rawBody, timestamp, secret)),
    "hex",
  );
  const given = Buffer.from(normalizeCustomPosSignature(signature), "hex");
  if (expected.length === 0 || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }

  return { valid: true };
}

/* ------------------------------ callback -------------------------------- */

/**
 * Custom POS status vocabulary → the canonical Marketplace lifecycle.
 *
 * The kitchen reports preparation states; the Marketplace names the same steps
 * ACCEPTED / PREPARING / READY / OUT_FOR_DELIVERY. `CANCELLED` and `REJECTED`
 * are terminal and trigger the refund orchestration in the handler. Lookup is
 * case-insensitive because provider casing is not a contract we can rely on.
 */
const CUSTOM_POS_STATUS_MAP: Record<string, MarketplaceOrderStatus> = {
  ACCEPTED: "ACCEPTED",
  ACCEPT: "ACCEPTED",
  IN_KITCHEN: "PREPARING",
  PREPARING: "PREPARING",
  FOOD_READY: "READY",
  READY: "READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DISPATCHED: "OUT_FOR_DELIVERY",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  REJECTED: "REJECTED",
};

/** Translate one custom-POS status; null means "never invent a status". */
export function mapCustomPosStatus(
  raw: string | null | undefined,
): MarketplaceOrderStatus | null {
  if (!raw) return null;
  const key = String(raw).trim().toUpperCase();
  if (!key) return null;
  return CUSTOM_POS_STATUS_MAP[key] ?? null;
}

/** Stable event id for the status ledger; a replay of one status dedupes. */
export function customPosEventId(externalOrderId: string, rawStatus: string): string {
  return `custom-pos:${externalOrderId}:${String(rawStatus).trim().toUpperCase()}`.slice(0, 500);
}

export type CustomPosCallbackParse =
  | {
      kind: "status";
      externalOrderId: string;
      status: MarketplaceOrderStatus;
      rawStatus: string;
      eventId: string;
    }
  | { kind: "ignored"; reason: string };

/**
 * Parse the inbound callback frame.
 *
 * Only an explicit status moves the order; anything else is acknowledged
 * without mutation so a provider retry loop converges. The tenant is resolved
 * from the order id in the next layer — the body's optional `restaurantId` is
 * never trusted as a scope.
 */
export function parseCustomPosCallback(body: unknown): CustomPosCallbackParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "ignored", reason: "NOT_AN_OBJECT" };
  }
  const obj = body as Record<string, unknown>;

  const rawOrderId =
    obj.orderId ??
    obj.order_id ??
    obj.externalOrderId ??
    obj.external_order_id;
  const externalOrderId =
    typeof rawOrderId === "string" || typeof rawOrderId === "number"
      ? String(rawOrderId).trim()
      : "";
  if (!externalOrderId) return { kind: "ignored", reason: "MISSING_ORDER_ID" };

  const rawStatusValue = obj.status ?? obj.orderStatus ?? obj.order_status;
  const rawStatus = typeof rawStatusValue === "string" ? rawStatusValue.trim() : "";
  if (!rawStatus) return { kind: "ignored", reason: "MISSING_STATUS" };

  const status = mapCustomPosStatus(rawStatus);
  if (!status) return { kind: "ignored", reason: "UNKNOWN_STATUS" };

  return {
    kind: "status",
    externalOrderId,
    status,
    rawStatus,
    eventId: customPosEventId(externalOrderId, rawStatus),
  };
}

/* -------------------------------- URLs ----------------------------------- */

export type CustomPosWebhookUrlResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: "MISSING" | "INVALID" | "UNSUPPORTED_PROTOCOL" | "CREDENTIALS" | "PRIVATE_HOST";
    };

/**
 * Validate and canonicalise an operator-supplied webhook endpoint.
 *
 * The URL is chosen by ops and then fetched by the Marketplace's own server, so
 * a bad value is both an availability bug and an SSRF primitive. Reject
 * anything that is not an absolute HTTP(S) URL, anything carrying embedded
 * credentials or a fragment, and (unless `allowPrivate` is set for a local dev
 * environment) private/reserved hosts. `url.toString()` is stored so the value
 * has one canonical form.
 */
export function validateCustomPosWebhookUrl(
  raw: unknown,
  opts: { allowPrivate?: boolean } = {},
): CustomPosWebhookUrlResult {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "MISSING" };
  if (value.length > MAX_WEBHOOK_URL_LENGTH) return { ok: false, reason: "INVALID" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "INVALID" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "UNSUPPORTED_PROTOCOL" };
  }
  if (url.username || url.password || url.hash) {
    return { ok: false, reason: "CREDENTIALS" };
  }
  if (!url.hostname) return { ok: false, reason: "INVALID" };
  if (!opts.allowPrivate && isPrivateOrReservedHost(url.hostname)) {
    return { ok: false, reason: "PRIVATE_HOST" };
  }

  return { ok: true, url: url.toString() };
}

/** The send-time form of a stored URL; private hosts were already screened. */
export function customPosSendUrl(raw: unknown): string | null {
  const result = validateCustomPosWebhookUrl(raw, { allowPrivate: true });
  return result.ok ? result.url : null;
}

/* --------------------------- push response ------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Pull a POS order id from the common response shapes; absence is fine. */
export function parseCustomPosOrderId(data: unknown): number | null {
  const obj = asRecord(data);
  if (!obj) return null;
  const nested = asRecord(obj.data);
  return (
    positiveInt(obj.posOrderId) ??
    positiveInt(obj.pos_order_id) ??
    positiveInt(obj.orderId) ??
    positiveInt(obj.order_id) ??
    positiveInt(nested?.posOrderId) ??
    positiveInt(nested?.pos_order_id) ??
    positiveInt(nested?.orderId) ??
    positiveInt(nested?.order_id) ??
    null
  );
}

/**
 * A 2xx body is allowed to say "not accepted" (`ok:false` / `success:false`).
 * Treat that as a deterministic rejection, not a retry loop.
 */
export function customPosResponseRejected(data: unknown): { rejected: boolean; message: string | null } {
  const obj = asRecord(data);
  if (!obj) return { rejected: false, message: null };
  const nested = asRecord(obj.data);
  const rejected = obj.ok === false || obj.success === false || nested?.ok === false || nested?.success === false;
  if (!rejected) return { rejected: false, message: null };
  const raw = obj.error ?? obj.message ?? nested?.error ?? nested?.message;
  return {
    rejected: true,
    message: typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 500) : null,
  };
}

/** A provider-supplied failure message, bounded and never a secret. */
export function customPosErrorMessage(data: unknown): string | null {
  const obj = asRecord(data);
  if (!obj) return null;
  const nested = asRecord(obj.data);
  const raw = obj.error ?? obj.message ?? nested?.error ?? nested?.message;
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 500) : null;
}
