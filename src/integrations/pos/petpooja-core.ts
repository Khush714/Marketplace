/**
 * Petpooja order-push contract, as pure functions.
 *
 * Petpooja is a second POS provider behind the same durable delivery journal as
 * the Restaurant AI bridge (`order-bridge.ts`). This module owns the parts that
 * are worth testing without a database or a network: the outbound payload shape,
 * the inbound status vocabulary, the callback timestamp window, and the push
 * response interpretation.
 *
 * No `server-only` here on purpose, matching `order-status.ts` and
 * `order-payload-shape.ts`: the order bridge and `node --test` both import it.
 *
 * Money is integer paise everywhere inside the Marketplace. The decimal strings
 * produced here are a wire encoding only; `formatCentsAsRupees` does the
 * conversion with integer arithmetic so no float rupee value ever exists.
 */

import { orderItemLineTotalCents, type OrderRow } from "@/db/schema";
import type { MarketplaceOrderStatus } from "@/integrations/pos/order-status";
import { posItemName } from "@/integrations/pos/order-payload-shape";

export type PetpoojaOrderType = "Delivery" | "PickUp";

export interface PetpoojaPushPayload {
  restID: string;
  order_info: {
    orderID: string;
    order_type: PetpoojaOrderType;
    total_amount: string;
    customer_name: string;
    customer_phone: string;
    items: Array<{
      item_id: string;
      item_name: string;
      quantity: number;
      price: string;
      special_instructions: string;
    }>;
  };
}

/**
 * Encode integer paise as a fixed two-decimal rupee string without ever
 * producing a float rupee amount.
 */
export function formatCentsAsRupees(cents: number): string {
  const rounded = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${sign}${whole}.${fraction.toString().padStart(2, "0")}`;
}

/** Petpooja expects a 10-digit Indian mobile number; keep the last 10 digits. */
export function normalizePetpoojaPhone(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/[^0-9]/g, "").slice(-10);
}

/**
 * Build the exact `order_info` frame the Petpooja push expects.
 *
 * The item id is the Marketplace menu item id, matching the id space the POS
 * already stores from menu sync — no name matching. Modifiers fold into the
 * line name (Petpooja has no modifier columns in the snippet contract), and the
 * unit price is the effective all-in per-unit amount so `price × quantity`
 * reproduces the line total the Marketplace charged.
 *
 * `orderID` is the caller-supplied stable external id (`mkt_ord_<id>`). The
 * caller passes it rather than this module deriving it, so the outbound id and
 * the inbound callback id can never drift.
 *
 * Petpooja's snippet shape has no order-level notes field, so the order's
 * kitchen instructions ride the first line's `special_instructions`. Repeating
 * them on every line would print the same note N times on the ticket.
 */
export function buildPetpoojaOrderPayload(
  order: Pick<
    OrderRow,
    "items" | "customerName" | "phone" | "instructions" | "totalCents"
  >,
  opts: { restId: string; externalOrderId: string; orderType?: PetpoojaOrderType },
): PetpoojaPushPayload {
  const items = order.items.map((item, index) => {
    const quantity = Math.max(1, Math.floor(item.quantity) || 1);
    const lineTotalCents = orderItemLineTotalCents(item);
    // Round the per-unit share to whole paise. A line whose total is not evenly
    // divisible by its quantity can differ from the order total by at most
    // `quantity - 1` paise; the order-level total below is authoritative.
    const unitCents = Math.round(lineTotalCents / quantity);
    return {
      item_id: String(item.menuItemId),
      item_name: posItemName(item),
      quantity,
      price: formatCentsAsRupees(unitCents),
      special_instructions: index === 0 ? (order.instructions ?? "") : "",
    };
  });

  return {
    restID: opts.restId,
    order_info: {
      orderID: opts.externalOrderId,
      order_type: opts.orderType ?? "Delivery",
      total_amount: formatCentsAsRupees(order.totalCents),
      customer_name: order.customerName,
      customer_phone: normalizePetpoojaPhone(order.phone),
      items,
    },
  };
}

/* --------------------------- inbound statuses --------------------------- */

/**
 * Petpooja's status vocabulary → the canonical Marketplace lifecycle.
 *
 * The pasted snippet mapped "Dispatched" to a generic "completed". That would
 * skip the customer's out-for-delivery stage and close the order before the
 * rider ever leaves, so it maps to OUT_FOR_DELIVERY here; "Delivered" and
 * "Completed" are the states that close the lifecycle.
 *
 * Lookup is case-insensitive after trimming, because the provider's casing is
 * not a contract we can rely on.
 */
const PETPOOJA_STATUS_MAP: Record<string, MarketplaceOrderStatus> = {
  NEW: "PLACED",
  PENDING: "PLACED",
  PLACED: "PLACED",
  ACCEPTED: "ACCEPTED",
  ACCEPT: "ACCEPTED",
  "FOOD BEING PREPARED": "PREPARING",
  PREPARING: "PREPARING",
  COOKING: "PREPARING",
  "FOOD READY FOR DISPATCH": "READY",
  "FOOD READY": "READY",
  READY: "READY",
  DISPATCHED: "OUT_FOR_DELIVERY",
  "OUT FOR DELIVERY": "OUT_FOR_DELIVERY",
  PICKED_UP: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  SERVED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
};

/** Translate one Petpooja status; null means "never invent a status". */
export function mapPetpoojaStatus(
  raw: string | null | undefined,
): MarketplaceOrderStatus | null {
  if (!raw) return null;
  const key = String(raw).trim().toUpperCase();
  if (!key) return null;
  return PETPOOJA_STATUS_MAP[key] ?? null;
}

/** Stable event id for the status ledger; the snippet sends no event id. */
export function petpoojaEventId(
  externalOrderId: string,
  eventType: string,
  rawStatus: string,
): string {
  return `petpooja:${externalOrderId}:${eventType}:${rawStatus}`.slice(0, 500);
}

export type PetpoojaCallbackParse =
  | {
      kind: "status";
      eventType: string;
      externalOrderId: string;
      status: MarketplaceOrderStatus;
      rawStatus: string;
      eventId: string;
    }
  | { kind: "ignored"; reason: string };

/**
 * Parse the inbound callback frame. Only `order_status_update` frames move the
 * order; anything else is acknowledged without mutation so a provider retry
 * loop converges instead of hammering the endpoint.
 */
export function parsePetpoojaCallback(body: unknown): PetpoojaCallbackParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "ignored", reason: "NOT_AN_OBJECT" };
  }
  const obj = body as Record<string, unknown>;

  const eventType = typeof obj.event_type === "string" ? obj.event_type.trim() : "";
  if (eventType !== "order_status_update") {
    return { kind: "ignored", reason: "UNSUPPORTED_EVENT" };
  }

  const rawOrderId = obj.orderID ?? obj.order_id ?? obj.external_order_id;
  const externalOrderId =
    typeof rawOrderId === "string" || typeof rawOrderId === "number"
      ? String(rawOrderId).trim()
      : "";
  if (!externalOrderId) return { kind: "ignored", reason: "MISSING_ORDER_ID" };

  const rawStatus = typeof obj.status === "string" ? obj.status.trim() : "";
  if (!rawStatus) return { kind: "ignored", reason: "MISSING_STATUS" };

  const status = mapPetpoojaStatus(rawStatus);
  if (!status) return { kind: "ignored", reason: "UNKNOWN_STATUS" };

  return {
    kind: "status",
    eventType,
    externalOrderId,
    status,
    rawStatus,
    eventId: petpoojaEventId(externalOrderId, eventType, rawStatus),
  };
}

/* ------------------------------ auth window ----------------------------- */

/** Shared skew cap for the callback timestamp (5 minutes). */
export const PETPOOJA_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Accept an ISO-8601 timestamp or Unix seconds/milliseconds, within 5 minutes.
 * An unparseable or stale timestamp fails closed.
 */
export function petpoojaTimestampValid(
  raw: string,
  now: number = Date.now(),
): boolean {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return false;

  let ms: number;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n)) return false;
    ms = trimmed.length >= 13 ? n : n * 1000;
  } else {
    ms = Date.parse(trimmed);
  }
  if (!Number.isFinite(ms)) return false;
  return Math.abs(now - ms) <= PETPOOJA_MAX_SKEW_MS;
}

/* ---------------------------- push response ----------------------------- */

export interface PetpoojaPushResult {
  ok: boolean;
  posOrderId: number | null;
  error: string | null;
}

/**
 * Interpret a Petpooja push response. The snippet treats `success === "1"` as
 * the only success value; accept the numeric/boolean equivalents too, because
 * a provider that changes encoding must not turn a successful push into a
 * retried duplicate.
 */
export function parsePetpoojaPushResponse(data: unknown): PetpoojaPushResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, posOrderId: null, error: "Petpooja returned an empty response" };
  }
  const obj = data as Record<string, unknown>;
  const nested =
    obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
      ? (obj.data as Record<string, unknown>)
      : null;

  const success = obj.success ?? nested?.success;
  const ok = success === "1" || success === 1 || success === true;

  const rawId = obj.order_id ?? obj.orderId ?? nested?.order_id ?? nested?.orderId;
  const numeric = rawId == null || rawId === "" ? NaN : Number(rawId);
  const posOrderId =
    Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;

  if (ok) return { ok: true, posOrderId, error: null };

  const rawMessage = obj.message ?? obj.error ?? nested?.message ?? nested?.error;
  const message =
    typeof rawMessage === "string" && rawMessage.trim()
      ? rawMessage.trim()
      : "Petpooja order push failed";
  return { ok: false, posOrderId: null, error: message.slice(0, 500) };
}

/*
 * Readiness lives in `readiness.ts`, not here. The question "can this record
 * take an order" is asked by the checkout gate, both delivery bridges, outlet
 * routing and the partner console; a Petpooja-specific copy would be the fifth
 * place for it to disagree. `integrationReadiness({ provider: "petpooja", ... })`
 * is the single rule, and it knows Petpooja uses partner credentials instead of
 * a sealed webhook secret.
 */
