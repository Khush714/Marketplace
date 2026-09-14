/**
 * PHASE 11 — INTEGRATION API CONTRACT.
 *
 * This module is the *single written contract* between the marketplace and
 * RestaurantAI. Every payload type, header, route and event name below is the
 * wire spec — nothing about the REST surface is decided inline in a route.
 *
 * Two directions:
 *
 *   INBOUND  — RestaurantAI → Marketplace (routes the marketplace serves).
 *              Auth: HMAC-SHA256 signature over the raw request body, keyed
 *              with the per-restaurant `webhook_secret` (see
 *              restaurant_integrations.webhook_secret). Header scheme below.
 *
 *   OUTBOUND — Marketplace → RestaurantAI (routes RestaurantAI must serve at
 *              its own `endpoint_url`, sending the payloads in this module).
 *              The marketplace signs outbound deliveries with the same
 *              webhook secret and the same header scheme.
 *
 * Process model: the REST business endpoints revealed by inspection already
 * exist and are authoritative — POS order queue (/api/pos/orders), lifecycle
 * transitions (/api/pos/orders/:ref/transition), the audit trail
 * (/api/pos/orders/:ref/events) and the connection handshake (/api/webhooks/pos).
 * The integration surface uses the SAME functions (transitionOrder,
 * getPublicOrder, getPublicMenu, …) — this contract is an alternative transport
 * for those operations, never a second implementation.
 */

/**
 * Error payload shape used by every contract endpoint.
 *   { error: string }                    basic
 *   { error: string, details: unknown }  validation failures / partial results
 */
export type IntegrationError = { error: string; details?: unknown };

// ---------------------------------------------------------------------------
// Signature scheme (both directions)
// ---------------------------------------------------------------------------

export const SIGNATURE_HEADER = "x-restaurantai-signature";
export const TIMESTAMP_HEADER = "x-restaurantai-timestamp";
export const API_KEY_HEADER = "x-integration-key";
// PHASE 17 — stable dedup key. The receiver MUST return the cached response
// for the same (scope, key) instead of re-processing. Every outbound retry
// carries this header so a network-induced retry never creates a duplicate.
export const IDEMPOTENCY_HEADER = "x-idempotency-key";

// ---------------------------------------------------------------------------
// PHASE 13 — Unified inbound webhook types.
// ---------------------------------------------------------------------------

/**
 * Accepted event types from RestaurantAI. Each maps to a specific processing
 * action inside the marketplace. Unknown types are recorded but not acted on,
 * so the webhook infrastructure is forward-compatible without code changes.
 */
export type InboundEventType =
  | "order.status_changed"
  | "order.cancelled"
  | "item.availability_changed"
  | "menu.updated"
  | "health.ping";

export const INBOUND_EVENT_LABELS: Record<InboundEventType, string> = {
  "order.status_changed": "Order status changed",
  "order.cancelled": "Order cancelled",
  "item.availability_changed": "Item availability changed",
  "menu.updated": "Menu updated",
  "health.ping": "Health check",
};

/**
 * Canonical inbound webhook body from RestaurantAI. All fields are required
 * for lifecycle events; event-specific data lives in `data`.
 */
export type InboundWebhookBody = {
  /** Unique event ID for dedup (required for lifecycle events). */
  event_id: string;
  /** Event type (see InboundEventType). */
  event: InboundEventType;
  /** Restaurant's own id (validated against the signing integration). */
  restaurant_id: string;
  /** Order reference or id (required for order events). */
  order_id?: string;
  /** PHASE 19 — the POS's own order id, if different from the marketplace reference. */
  externalOrderId?: string;
  /** New status for status_changed / cancelled events. */
  status?: string;
  /** Event-specific payload (item availability, menu changes, etc.). */
  data?: Record<string, unknown>;
  /** ISO timestamp of when the event occurred on RestaurantAI's side. */
  occurred_at?: string;
};

export type InboundWebhookResponse =
  | { ok: true; eventId: string; processed: boolean }
  | { ok: false; error: string; eventId?: string };

/**
 * Signature value: an HMAC-SHA256 hex digest of the raw UTF-8 request body,
 * keyed with the restaurant's webhook secret and always scoped to a timestamp
 * so a captured request can never be replayed after the freshness window.
 *
 *   signature = hex( HMAC-SHA256( webhookSecret, "<epochMs>\n<rawBody>" ) )
 *
 * `request.headers[timestamp]` must be within SIGNATURE_FRESHNESS_MS of now.
 */
export const SIGNATURE_FRESHNESS_MS = 5 * 60 * 1000;

/** Raw body must be re-read before any JSON parsing — do not mutate it. */
export function signaturePayload(epochMs: string, rawBody: string): string {
  return `${epochMs}\n${rawBody}`;
}

// ---------------------------------------------------------------------------
// Inbound: RestaurantAI → Marketplace
// ---------------------------------------------------------------------------

export type IntegrationVerifyResponse = {
  ok: true;
  restaurant: {
    marketplaceId: string;
    slug: string;
    name: string;
    externalRestaurantId: string | null;
  };
  connection: {
    status: string;
    provider: string;
    capabilities: Record<string, unknown>;
    connectedAt: string | null;
    lastSyncAt: string | null;
  };
};

/**
 * GET /api/integration/menu?key=<webhookSecret>
 * RestaurantAI pulls the marketplace's current menu (the same menu the admin
 * editor and the customer view use), keyed by the external ids RestaurantAI
 * published earlier. `updatedSince` (ISO) limits the response to categories
 * and items whose created_at/updated_at changed after the given instant.
 */
export type MenuModifierContract = {
  /** Marketplace serial id (stable within a sync window). */
  modifierId: number;
  name: string;
  priceDelta: number;
  available: boolean;
};

export type MenuModifierGroupContract = {
  groupId: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: MenuModifierContract[];
};

export type MenuItemContract = {
  /** Permanent marketplace id (e.g. "item_82931") — never the serial id. */
  itemId: string;
  /** RestaurantAI's own id for this item (empty until first sync). */
  externalId: string | null;
  name: string;
  description: string;
  price: number;
  available: boolean;
  vegetarian: boolean;
  popular: boolean;
  categoryId: string | null;
  modifierGroups: MenuModifierGroupContract[];
};

export type MenuCategoryContract = {
  categoryId: string;
  externalId: string | null;
  name: string;
  items: MenuItemContract[];
};

export type MenuSyncResponse = {
  restaurant: { marketplaceId: string; slug: string; name: string };
  updatedSince: string | null;
  categories: MenuCategoryContract[];
  itemCount: number;
  syncedAt: string;
};

/**
 * POST /api/integration/webhooks/order-status
 * RestaurantAI reports that an order it already received changed on ITS side
 * (e.g. a floor display advanced it, or a kitchen ticket was marked ready).
 * The marketplace validates the transition against the canonical lifecycle
 * and writes the SAME state machine the POS queue writes — one source of truth.
 */
export type OrderStatusWebhookBody = {
  /** Marketplace order reference (e.g. "MKT-A1B2C3"). */
  orderReference: string;
  /** Canonical target status (lowercase wire keys): accepted | preparing |
   *  ready | picked_up | delivered | cancelled | rejected. */
  status: string;
  note?: string;
  /** RestaurantAI's own order id, echoed back for its reconciliation. */
  externalOrderId?: string;
};

export type OrderStatusWebhookResponse =
  | { ok: true; order: { reference: string; status: string } }
  | { ok: false; error: string; details?: unknown };

/**
 * POST /api/integration/webhooks/item-availability
 * RestaurantAI pushes stock/availability changes for items it already mapped.
 * Accepted atomically per item: known external ids flip marketplace
 * availability; unknown ids are reported in `ignored` (never guessed).
 */
export type ItemAvailabilityWebhookBody = {
  items: { externalId: string; available: boolean }[];
};

export type ItemAvailabilityWebhookResponse = {
  ok: true;
  updated: { externalId: string; available: boolean }[];
  ignored: { externalId: string; reason: string }[];
};

/**
 * POST /api/integration/webhooks/menu-updated
 * RestaurantAI signals that its menu changed and the marketplace should
 * re-pull /api/integration/menu. Lightweight acknowledgment; the marketplace
 * optionally marks its next pull as forced (ignores updatedSince caching).
 */
export type MenuUpdatedWebhookBody = {
  externalRestaurantId?: string;
  forced?: boolean;
  changedAt?: string;
};

export type MenuUpdatedWebhookResponse = {
  ok: true;
  acknowledgedAt: string;
  menuUrl: string;
};

// ---------------------------------------------------------------------------
// Outbound: Marketplace → RestaurantAI
// (routes RestaurantAI must expose under its own `endpoint_url`)
// ---------------------------------------------------------------------------

/** POST {endpoint}/integration/orders — a new marketplace order. */
export type OutboundOrderEvent = {
  event: "order.created";
  /** PHASE 17 — stable idempotency key. Unique per restaurant/integration.
   *  RestaurantAI MUST use this as its dedup key: if it already received an
   *  order with this id it MUST return the existing order, never re-create. */
  external_order_id: string;
  order: {
    reference: string;
    status: string;
    fulfillment: "pickup" | "delivery";
    payment: { method: string; status: string; total: number };
    customer: { name: string; address: string };
    restaurant: { marketplaceId: string; slug: string; name: string };
    items: {
      externalId: string | null;
      name: string;
      quantity: number;
      unitPrice: number;
      modifiers: { name: string; priceDelta: number }[];
    }[];
    totals: { subtotal: number; tax: number; discount: number; deliveryFee: number; total: number };
    scheduledFor: string | null;
    placedAt: string;
  };
};

/** POST {endpoint}/integration/orders/:reference/cancel — a cancellation. */
export type OutboundOrderCancelEvent = {
  event: "order.cancelled";
  /** PHASE 17 — stable idempotency key. Cancellation of an already-cancelled
   *  order MUST be acknowledged (200) but not re-processed. */
  external_order_id: string;
  order: { reference: string; status: string };
  reason?: string;
};