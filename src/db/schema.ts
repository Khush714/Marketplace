import type {
  CategoryMappingEcho,
  ItemMappingEcho,
  ModifierGroupMappingEcho,
  ModifierMappingEcho,
} from "@/db/menu-mapping-echo";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export interface ModifierSelectionSnapshot {
  optionId: number;
  name: string;
  priceCents: number;
  quantity: number;
}

export interface OrderItemSnapshot {
  menuItemId: number;
  name: string;
  priceCents: number;
  quantity: number;
  imageUrl: string;
  isVeg: boolean;
  /** Selected modifiers (POS-synced), priced at serve time in computeBill. */
  modifiers?: ModifierSelectionSnapshot[];
}

/**
 * What a snapshot line actually costs: base × qty plus its modifier selection.
 * computeBill charges modifiers once per line (not per unit), so every renderer
 * and the POS bridge must use this same shape or the item list stops summing to
 * the order subtotal.
 */
export function orderItemLineTotalCents(item: OrderItemSnapshot): number {
  const modifiers = (item.modifiers ?? []).reduce((s, m) => s + m.priceCents * m.quantity, 0);
  return item.priceCents * item.quantity + modifiers;
}

export const restaurants = pgTable("restaurants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  cuisines: text("cuisines").array().notNull(),
  rating: real("rating").notNull().default(4.2),
  ratingsCount: integer("ratings_count").notNull().default(1000),
  priceLevel: integer("price_level").notNull().default(2),
  deliveryMinutes: integer("delivery_minutes").notNull().default(30),
  /**
   * Distance from the customer's locality, when the platform actually knows it.
   *
   * NULL is the honest "we have not measured this" — it is what a newly
   * onboarded restaurant gets, because onboarding never measured it. The schema
   * default of 2 existed so seeded demo rows sort; inheriting it at redemption
   * (as `rating` used to) printed an invented "2.0 km" on every new listing and
   * made `sort=near` rank by a constant. Customer surfaces render "Nearby"
   * instead while this is null — see `hasDistance` in lib/domain.ts.
   */
  distanceKm: real("distance_km"),
  offer: text("offer"),
  offerPercent: integer("offer_percent").notNull().default(0),
  offerMaxCents: integer("offer_max_cents").notNull().default(0),
  imageUrl: text("image_url").notNull(),
  heroUrl: text("hero_url").notNull(),
  featured: boolean("featured").notNull().default(false),
  pureVeg: boolean("pure_veg").notNull().default(false),
  locality: text("locality").notNull().default("Old City"),
  isActive: boolean("is_active").notNull().default(true),
  externalId: text("external_id").unique(),
  /**
   * Server-generated canonical public ID (rst_…) the POS ecosystem treats as
   * the stable "Marketplace External Restaurant ID". Assigned on first login
   * when absent; partners may never choose or collide on it.
   */
  marketplaceId: text("marketplace_id").unique(),
  ownerKeyHash: text("owner_key_hash"),
  /**
   * The POS passkey, hashed. Deliberately a SEPARATE credential from
   * `ownerKeyHash`: passkey rotation writes only this column, so rotating the
   * integration secret can never invalidate the key the restaurant holds for
   * /partner, /partner/menu and /partner/integrations.
   *
   * NULL means "never separated" — rows onboarded before this column existed
   * (and listings ops provisioned for the POS) fall back to `ownerKeyHash` at
   * authentication time. A non-null value here SHADOWS the owner key: after the
   * first rotation the old shared key stops being a valid passkey, which is the
   * entire point of rotating.
   */
  integrationPasskeyHash: text("integration_passkey_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One restaurant's synced menu mirror (server-authoritative POS source).
 * `restaurantId` + `posCategoryId` is identity: a Marketplace minted id is
 * assigned once and retried/re-synced payloads resolve to it (never re-minted
 * by name). `isActive` gates surfacing; `sortOrder` preserves POS ordering.
 */
export const menuCategories = pgTable(
  "menu_categories",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    // bigint, not integer: the POS mints menu ids as epoch milliseconds
    // (~1.79e12), which overflows int4. `mode: "number"` keeps the driver
    // mapping to a JS number so the Map<number, number> id lookups in
    // menu-sync.ts stay exact.
    posCategoryId: bigint("pos_category_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("menu_categories_restaurant_pos_idx").on(t.restaurantId, t.posCategoryId)],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceCents: integer("price_cents").notNull(),
    imageUrl: text("image_url").notNull(),
    isVeg: boolean("is_veg").notNull().default(false),
    isBestseller: boolean("is_bestseller").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    available: boolean("available").notNull().default(true),
    posItemId: bigint("pos_item_id", { mode: "number" }),
    posCategoryId: bigint("pos_category_id", { mode: "number" }),
    categoryId: integer("category_id").references(() => menuCategories.id, {
      onDelete: "set null",
    }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    index("menu_restaurant_idx").on(t.restaurantId),
    unique("menu_items_restaurant_pos_item_idx").on(t.restaurantId, t.posItemId),
  ],
);

export const connectionCodes = pgTable("connection_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  status: text("status").notNull().default("unused"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const connections = pgTable("connections", {
  id: serial("id").primaryKey(),
  codeId: integer("code_id")
    .notNull()
    .unique()
    .references(() => connectionCodes.id),
  restaurantId: integer("restaurant_id")
    .notNull()
    .unique()
    .references(() => restaurants.id),
  marketplace: text("marketplace").notNull().default("crave"),
  status: text("status").notNull().default("active"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrationSessions = pgTable("integration_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  restaurantId: integer("restaurant_id")
    .notNull()
    .references(() => restaurants.id),
  codeId: integer("code_id")
    .notNull()
    .references(() => connectionCodes.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One-to-one POS identity record for a marketplace restaurant. Traces the
 * identity chain Marketplace → POS Restaurant → Branch → Outlet. `status`:
 * "pending" (connected, not yet claimed), "active", "disabled".
 */
export const integrationRecords = pgTable(
  "integration_records",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .unique()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("restaurant-ai"),
    posRestaurantId: text("pos_restaurant_id"),
    posBranchId: text("pos_branch_id"),
    posOutletId: text("pos_outlet_id"),
    status: text("status").notNull().default("pending"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    /**
     * POS webhook secret, wrapped at-rest as an AES-256-GCM envelope encoded in
     * base64 (`v1.<iv>.<tag>.<cipher>`). Read by the menu webhook verifier only;
     * never returned to any client. Null until the POS sends its first claim.
     */
    webhookSecret: text("webhook_secret"),
    /**
     * Latest menu version we've served to the POS. Echoed back in every webhook
     * response so the POS can ack `marketplace_menu_ack_version`.
     */
    latestMenuVersion: integer("latest_menu_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("integration_records_restaurant_idx").on(t.restaurantId)],
);

/**
 * A request to move a `marketplace_id` from one listing to another.
 *
 * `restaurants.marketplace_id` is UNIQUE, so a POS that reconnects under a new
 * listing while its id is still held elsewhere cannot complete a claim. That
 * refusal arrives after the POS has burned its single-use connection code, so
 * without a queue the only recovery was hand-editing `restaurants`. Ops approves
 * or denies here; nothing moves without a decision row.
 */
export const integrationTransferRequests = pgTable(
  "integration_transfer_requests",
  {
    id: serial("id").primaryKey(),
    requestedByRestaurantId: integer("requested_by_restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    previousRestaurantId: integer("previous_restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    marketplaceId: text("marketplace_id").notNull(),
    posRestaurantId: text("pos_restaurant_id"),
    status: text("status").notNull().default("pending"),
    note: text("note"),
    requestedByIp: text("requested_by_ip"),
    decidedBy: text("decided_by"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("integration_transfer_requests_status_idx").on(t.status, t.requestedAt),
    // Mirrors the partial UNIQUE index in the migration: only pending rows are
    // constrained, so decided requests stay as history.
    uniqueIndex("integration_transfer_requests_pending_uniq")
      .on(t.marketplaceId, t.requestedByRestaurantId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** Append-only audit trail for integration actions (login, rotate, identity…). */
export const integrationAudit = pgTable(
  "integration_audit",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").references(() => restaurants.id, {
      onDelete: "set null",
    }),
    actor: text("actor").notNull(),
    event: text("event").notNull(),
    detail: jsonb("detail"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("integration_audit_restaurant_idx").on(t.restaurantId)],
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id),
    restaurantName: text("restaurant_name").notNull(),
    restaurantSlug: text("restaurant_slug").notNull(),
    items: jsonb("items").notNull().$type<OrderItemSnapshot[]>(),
    addressLabel: text("address_label").notNull().default("Home"),
    addressText: text("address_text").notNull(),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    paymentMethod: text("payment_method").notNull().default("upi"),
    /**
     * Marketplace payment lifecycle, separate from `integrationStatus`:
     * UNPAID → PAYMENT_PENDING → PAID | FAILED, then REFUND_PENDING →
     * PARTIALLY_REFUNDED | REFUNDED on refunds, PAYMENT_CANCELLED for a
     * cancelled-but-unpaid order. Orders in the kitchen can hold PAID while
     * `integrationStatus` is PREPARING/READY (payment state is orthogonal to
     * order state). Source of truth is the linked marketplace_payments row.
     */
    paymentStatus: text("payment_status").notNull().default("UNPAID"),
    instructions: text("instructions").notNull().default(""),
    riderName: text("rider_name").notNull().default("Arjun Mehta"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    /**
     * Client-supplied idempotency key: the first order carrying a given key
     * wins; retries return the same order instead of creating a duplicate.
     */
    clientRequestId: text("client_request_id").unique(),
    /**
     * Stable external order id sent to the POS bridge (`mkt_ord_<id>`). Only
     * set once the order is eligible for POS delivery; NULL for demo/legacy
     * orders that never ship to the POS.
     */
    externalOrderId: text("external_order_id"),
    /**
     * The POS order id echoed back on successful delivery (marketplace_order_ingest).
     * bigint, not integer: the POS declares epoch-ms as its id convention, which
     * overflows int4. `mode: "number"` keeps the driver's JS-number mapping so the
     * equality checks in pos-delivery.ts stay exact.
     */
    posOrderId: bigint("pos_order_id", { mode: "number" }),
    /**
     * Was this order admitted while the restaurant had an ACTIVE POS
     * integration? Stamped at creation rather than re-derived, because the
     * tracking view must keep showing the lifecycle the order was actually
     * admitted into even if the integration is disabled mid-flight.
     *
     * FALSE is the honest answer for a seeded/demo restaurant, which restores
     * the elapsed-time demo timeline the tracking view was written for.
     * Deriving this from `external_order_id` does NOT work: that column is
     * stamped on every order unconditionally, so it is true for all of them.
     */
    posConnected: boolean("pos_connected").notNull().default(false),
    /** Snapshot of the delivery journal row: PENDING → DELIVERED | FAILED. */
    posDeliveryStatus: text("pos_delivery_status").notNull().default("PENDING"),
    /**
     * POS branch/outlet claim for this order (Phase 7). The client's optional
     * `outletId` at checkout is validated against the integration record; the
     * authoritative branch_id/outlet_id are persisted once the POS bridge
     * acknowledges ingestion. NULL for legacy single-branch integrations.
     */
    outletId: text("outlet_id"),
    branchId: text("branch_id"),
    /**
     * Real POS lifecycle status (PLACED → PREPARING → READY → COMPLETED, or
     * CANCELLED/REJECTED terminal). `tracking-view` renders this instead of the
     * elapsed-time demo timeline for POS-connected orders.
     */
    integrationStatus: text("integration_status").notNull().default("PLACED"),
    /** When `integrationStatus` last transitioned (status webhooks). */
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_phone_idx").on(t.phone),
    uniqueIndex("orders_external_order_id_unique").on(t.externalOrderId),
  ],
);

/**
 * Delivery journal — the durable at-least-once record of every Marketplace
 * order that must reach the POS order bridge (`POST /integrations/marketplace/
 * orders`). Enqueued synchronously at checkout, drained on a retry worker:
 *   PENDING  → currently owed; drain attempts it (backoff ×4, max 5 attempts)
 *   DELIVERED → POS acknowledged (`pos_order_id` filled; a replay of the same
 *              external id returns the same POS order — POS-side idempotency).
 *   FAILED   → terminal outcome that must NOT be retried (e.g. 401/403/422
 *              unmapped items, or all retry attempts exhausted).
 */
export const posOrderDeliveries = pgTable(
  "marketplace_pos_order_deliveries",
  {
    id: serial("id").primaryKey(),
    marketplaceOrderId: integer("marketplace_order_id").notNull(),
    externalOrderId: text("external_order_id").notNull(),
    restaurantId: integer("restaurant_id").notNull(),
    // bigint: POS order ids may be epoch-ms, which overflows int4.
    posOrderId: bigint("pos_order_id", { mode: "number" }),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pos_deliveries_status_attempt_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("pos_order_deliveries_marketplace_order_id_unique").on(t.marketplaceOrderId),
    uniqueIndex("pos_order_deliveries_external_order_id_unique").on(t.externalOrderId),
    // Short FK names — auto-generated ones exceed Postgres's 63-char limit and
    // churn on every push (see menu_item_mod_groups_mod_group_fk note).
    foreignKey({
      name: "pos_deliveries_marketplace_order_fk",
      columns: [t.marketplaceOrderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_deliveries_restaurant_fk",
      columns: [t.restaurantId],
      foreignColumns: [restaurants.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Marketplace payment journal (Phase 6). Each marketplace order has at most one
 * live payment recorded per provider; `payment_reference` (PAY-…) is the
 * Marketplace-owned idempotency key and `provider_payment_id` is the provider
 * (e.g. Razorpay pay_…) id. UNIQUE(provider, provider_payment_id) means a
 * provider's duplicate capture event can never mint a second payment row.
 * `amount_cents` is the exact integer-paise value verified against
 * orders.total_cents; `amount` mirrors it in rupees for POS parity.
 */
export const marketplacePayments = pgTable(
  "marketplace_payments",
  {
    id: serial("id").primaryKey(),
    paymentReference: text("payment_reference").notNull().unique(),
    marketplaceOrderId: integer("marketplace_order_id").notNull(),
    externalOrderId: text("external_order_id").notNull(),
    restaurantId: integer("restaurant_id").notNull(),
    provider: text("provider").notNull().default("razorpay"),
    /** Provider payment id (e.g. pay_…) — NULL until the first provider event. */
    providerPaymentId: text("provider_payment_id"),
    /**
     * Provider order/session id (e.g. order_…) allocated at checkout. The
     * capture webhook resolves the local payment through this binding BEFORE the
     * provider payment id is ever known — Razorpay's payment entity carries its
     * order_id, so first-sight capture links pay_… to the recorded order.
     */
    providerOrderId: text("provider_order_id"),
    /** Exact order total in paise (verified against orders.total_cents). */
    amountCents: integer("amount_cents").notNull().default(0),
    /** Rupee mirror of amountCents (POS parity: the POS books rupees). */
    amount: real("amount").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default("PAYMENT_PENDING"),
    method: text("method"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_payments_provider_payment_idx").on(t.provider, t.providerPaymentId),
    uniqueIndex("marketplace_payments_provider_order_idx").on(t.provider, t.providerOrderId),
    index("marketplace_payments_order_idx").on(t.marketplaceOrderId),
    index("marketplace_payments_restaurant_idx").on(t.restaurantId),
    index("marketplace_payments_status_idx").on(t.status),
    foreignKey({
      name: "marketplace_payments_order_fk",
      columns: [t.marketplaceOrderId],
      foreignColumns: [orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "marketplace_payments_restaurant_fk",
      columns: [t.restaurantId],
      foreignColumns: [restaurants.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Idempotent provider-webhook ledger (Phase 6). Every payment event from the
 * provider carries a stable `event_id`; the first insert wins and replays are
 * acknowledged with 200 without re-applying any state transition
 * (ON CONFLICT(event_id) DO NOTHING at write time). `payload_hash` lets the
 * reconciliation job prove the recorded payload matches what ran.
 */
export const marketplacePaymentEvents = pgTable(
  "marketplace_payment_events",
  {
    id: serial("id").primaryKey(),
    eventId: text("event_id").notNull(),
    provider: text("provider").notNull().default("razorpay"),
    eventType: text("event_type").notNull(),
    paymentReference: text("payment_reference"),
    payloadHash: text("payload_hash"),
    status: text("status").notNull().default("PROCESSED"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("marketplace_payment_events_event_id_unique").on(t.eventId),
    index("marketplace_payment_events_payment_idx").on(t.paymentReference),
    foreignKey({
      name: "payment_events_restaurant_fk",
      columns: [t.paymentReference],
      foreignColumns: [marketplacePayments.paymentReference],
    }).onDelete("set null"),
  ],
);

/**
 * At-least-once delivery journal for Marketplace → POS payment webhook pushes
 * (Phase 6). Mirrors the order-delivery journal: PENDING is drained with
 * backoff until DELIVERED (POS acknowledged, idempotently) or terminal
 * FAILED. `event_id` is the deterministic bridge event id
 * (PAY-…:payment.captured) — the same value on every retry, so POS-side
 * webhook_events dedup makes racing/replayed sends safe.
 */
export const marketplacePosPaymentDeliveries = pgTable(
  "marketplace_pos_payment_deliveries",
  {
    id: serial("id").primaryKey(),
    marketplacePaymentId: integer("marketplace_payment_id").notNull(),
    externalOrderId: text("external_order_id").notNull(),
    restaurantId: integer("restaurant_id").notNull(),
    eventType: text("event_type").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_payment_deliveries_event_id_unique").on(t.eventId),
    index("pos_payment_deliveries_status_attempt_idx").on(t.status, t.nextAttemptAt),
    index("pos_payment_deliveries_payment_idx").on(t.marketplacePaymentId),
    foreignKey({
      name: "pos_payment_deliveries_payment_fk",
      columns: [t.marketplacePaymentId],
      foreignColumns: [marketplacePayments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pos_payment_deliveries_restaurant_fk",
      columns: [t.restaurantId],
      foreignColumns: [restaurants.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Deduplication ledger for POS order-status webhooks. Every event carries a
 * stable `event_id`; the first row for an event_id wins and its status
 * transition is applied exactly once (duplicate replays echo 200, no re-write).
 * `payload_hash` lets the webhook handler detect a replay whose payload differs
 * from the one that already ran (event_id replay → `replay_conflict`).
 */
export const marketplaceOrderEvents = pgTable(
  "marketplace_order_events",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id").notNull(),
    eventId: text("event_id").notNull(),
    externalOrderId: text("external_order_id").notNull(),
    // bigint: POS order ids may be epoch-ms, which overflows int4.
    posOrderId: bigint("pos_order_id", { mode: "number" }),
    status: text("status").notNull(),
    payloadHash: text("payload_hash"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("marketplace_order_events_restaurant_idx").on(t.restaurantId),
    uniqueIndex("marketplace_order_events_event_id_unique").on(t.eventId),
    foreignKey({
      name: "order_events_restaurant_fk",
      columns: [t.restaurantId],
      foreignColumns: [restaurants.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Modifier group (e.g. "Extra toppings"). POS is authority on min/max selection
 * bounds and availability; the Marketplace copies these to keep checkout bill
 * validation deterministic without a reverse call.
 */
export const modifierGroups = pgTable(
  "modifier_groups",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    posGroupId: bigint("pos_group_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("modifier_groups_restaurant_pos_idx").on(t.restaurantId, t.posGroupId)],
);

/**
 * One selectable modifier option inside a group (e.g. "Paneer → +₹60").
 * `posGroupId` mirrors the parent group's POS id; `priceCents` is the POS
 * increment in paise. `available` false = sold out at the POS.
 */
export const modifierOptions = pgTable(
  "modifier_options",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    posGroupId: bigint("pos_group_id", { mode: "number" }).notNull(),
    posOptionId: bigint("pos_option_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull().default(0),
    isVeg: boolean("is_veg").notNull().default(true),
    available: boolean("available").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("modifier_options_group_pos_idx").on(t.groupId, t.posOptionId),
    index("modifier_options_restaurant_idx").on(t.restaurantId),
  ],
);

/** Bridge: which modifier groups apply to a given menu item. */
export const menuItemModifierGroups = pgTable(
  "menu_item_modifier_groups",
  {
    id: serial("id").primaryKey(),
    menuItemId: integer("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    modifierGroupId: integer("modifier_group_id").notNull(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("menu_item_mod_groups_item_group_idx").on(t.menuItemId, t.modifierGroupId),
    index("menu_item_mod_groups_restaurant_idx").on(t.restaurantId),
    // Explicit short name: drizzle's auto-generated FK name exceeds Postgres's
    // 63-char limit and Postgres truncates it, which makes every `db:push`
    // drop/re-add the constraint forever. A stable ≤63-char name ends the churn.
    foreignKey({
      name: "menu_item_mod_groups_mod_group_fk",
      columns: [t.modifierGroupId],
      foreignColumns: [modifierGroups.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Idempotent menu-webhook ledger. Every inbound event carries a POS `event_id`;
 * the first row for that event_id wins and its minted ids are the canonical
 * ones returned on EVERY retry (Step: dedupe → original ids, never re-mint).
 * Also the source of truth for the `menu_version` echo the POS acks back.
 */
export type MenuWebhookEntity =
  | "category"
  | "item"
  | "modifier_group"
  | "modifier"
  | "sync";

export type MenuWebhookAction =
  | "menu.sync"
  | "item.created"
  | "item.updated"
  | "item.deleted"
  | "category.created"
  | "category.updated"
  | "category.deleted"
  | "modifier_group.created"
  | "modifier_group.updated"
  | "modifier_group.deleted"
  | "modifier.created"
  | "modifier.updated"
  | "modifier.deleted";

/**
 * Minted-id echoes the POS captures from a `menu.sync` response.
 *
 * Each entry carries the id under TWO keys and both must always be populated:
 * `id` is the Marketplace's own numeric id (what the `menu_item_id`-style single
 * entity responses use), while `marketplace_*_id` is the entity-scoped name the
 * POS reads in `persistAssignmentsFromResponse`
 * (Backend/integrations/marketplace/menu.js). Emitting only `id` left the POS
 * writing the literal string "undefined" into its mapping tables — and because
 * `marketplace_category_mappings` is unique on
 * (restaurant_id, marketplace_category_id), the FIRST category won that unique
 * key and every later one failed its insert. A 6-category sync produced 1 usable
 * category mapping and 1 of 3 modifier mappings. Always emit both.
 */
export type MenuMappings = {
  categories?: CategoryMappingEcho[];
  items?: ItemMappingEcho[];
  modifier_groups?: ModifierGroupMappingEcho[];
  modifiers?: ModifierMappingEcho[];
};

export const menuWebhookEvents = pgTable(
  "menu_webhook_events",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    /** Minted id(s) returned for this event_id on every replay. */
    mappings: jsonb("mappings").$type<MenuMappings>(),
    /** The single-entity minted id (item/category/modifier_group/modifier). */
    mintedEntityId: integer("minted_entity_id"),
    /** Echoed menu_version the POS acks; unchanged on deduped replays. */
    menuVersion: integer("menu_version").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("menu_webhook_events_event_id_unique").on(t.eventId),
    index("menu_webhook_events_restaurant_idx").on(t.restaurantId),
  ],
);

export type MenuCategoryRow = typeof menuCategories.$inferSelect;
export type ModifierGroupRow = typeof modifierGroups.$inferSelect;
export type ModifierOptionRow = typeof modifierOptions.$inferSelect;
export type MenuItemModifierGroupRow = typeof menuItemModifierGroups.$inferSelect;
export type MenuWebhookEventRow = typeof menuWebhookEvents.$inferSelect;

export type RestaurantRow = typeof restaurants.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type PosOrderDeliveryRow = typeof posOrderDeliveries.$inferSelect;
export type MarketplacePaymentRow = typeof marketplacePayments.$inferSelect;
export type MarketplacePaymentEventRow = typeof marketplacePaymentEvents.$inferSelect;
export type MarketplacePosPaymentDeliveryRow = typeof marketplacePosPaymentDeliveries.$inferSelect;
export type MarketplaceOrderEventRow = typeof marketplaceOrderEvents.$inferSelect;
export type ConnectionCodeRow = typeof connectionCodes.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type IntegrationSessionRow = typeof integrationSessions.$inferSelect;
export type IntegrationRecordRow = typeof integrationRecords.$inferSelect;
export type IntegrationAuditRow = typeof integrationAudit.$inferSelect;
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_sessions_token_hash_idx").on(t.tokenHash),
    index("admin_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type AdminSessionRow = typeof adminSessions.$inferSelect;
