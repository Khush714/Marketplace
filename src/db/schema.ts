import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  numeric,
  timestamp,
  index,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// POS CORE (baseline, Phase 0)
// Identity + operations only. Marketplace-only concerns were moved OUT of this
// table in Phase 2 so the POS is not carrying storefront commerce fields.
// ---------------------------------------------------------------------------

export const restaurants = pgTable(
  "restaurants",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 180 }).notNull().unique(),
    // PHASE 32 — permanent marketplace identity (e.g. "rst_01J8abc123").
    // Stable across DB restores and the token external systems (POS, webhooks)
    // use to reference a restaurant instead of the serial id.
    marketplaceId: varchar("marketplace_id", { length: 24 }).notNull(),
    cuisine: varchar("cuisine", { length: 80 }).notNull(),
    description: text("description").notNull().default(""),
    address: varchar("address", { length: 240 }).notNull().default(""),
    // PHASE 32 — restaurant phone (public identity record) + opening hours
    // (JSON: ISO day key → open/close windows, e.g. {"mon":[{"open":"10:00","close":"22:00"}]}).
    phone: varchar("phone", { length: 40 }).notNull().default(""),
    openingHours: text("opening_hours").notNull().default("{}"),
    imageUrl: text("image_url").notNull().default(""),
    priceRange: varchar("price_range", { length: 8 }).notNull().default("$$"),
    isOpen: boolean("is_open").notNull().default(true),
    // POS-native tax rate (e.g. 0.0875 = 8.75%). Charged at ticket time,
    // whether the ticket originates from the counter or the marketplace.
    taxRate: numeric("tax_rate", { precision: 6, scale: 4 })
      .notNull()
      .default("0"),
    // PHASE 19 — restaurant coordinates + delivery radius (km).
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    deliveryRadiusKm: numeric("delivery_radius_km", { precision: 6, scale: 2 })
      .notNull()
      .default("8"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("restaurants_cuisine_idx").on(t.cuisine),
    unique("restaurants_marketplace_id_key").on(t.marketplaceId),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    // PHASE 34 — optional ownership pointer to the (default) menu container.
    // NULL keeps the pre-existing restaurant_id model working untouched.
    menuId: integer("menu_id").references(() => menus.id, {
      onDelete: "set null",
    }),
    // PHASE 34 — permanent marketplace identity (e.g. "cat_01J8abc123"),
    // mirroring restaurants.marketplace_id so future POS sync can reference
    // categories without exposing the serial id.
    marketplaceId: varchar("marketplace_id", { length: 24 }).notNull(),
    // PHASE 35 — external POS/chain category id (e.g. "pos_cat_41") published
    // by RestaurantAI. Uniqueness per restaurant is enforced by
    // categories_external_key.
    externalId: varchar("external_id", { length: 80 }),
    name: varchar("name", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("categories_restaurant_idx").on(t.restaurantId),
    index("categories_menu_idx").on(t.menuId),
    index("categories_external_idx").on(t.externalId),
    unique("categories_marketplace_id_key").on(t.marketplaceId),
    uniqueIndex("categories_external_key")
      .on(t.restaurantId, t.externalId)
      .where(sql`length(btrim(${t.externalId})) > 0`),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 31 — MENUS (integration container).
//
// The POS's physical catalog stays authoritative in `categories` + `menu_items`.
// `menus` is the marketplace-side container that will map to a POS/chain menu
// later via `external_id`. Every restaurant gets one default menu; menu_items
// may optionally point at it through menu_id, but NULL keeps the pre-existing
// restaurant_id model working untouched.
// ---------------------------------------------------------------------------

export const menus = pgTable(
  "menus",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    // PHASE 34 — permanent marketplace identity (e.g. "menu_01J8abc123"),
    // mirroring restaurants.marketplace_id so future POS sync can reference
    // this menu without exposing the serial id.
    marketplaceId: varchar("marketplace_id", { length: 24 }).notNull(),
    name: varchar("name", { length: 120 }).notNull().default("Menu"),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active | archived
    isDefault: boolean("is_default").notNull().default(true),
    source: varchar("source", { length: 16 })
      .notNull()
      .default("manual"), // manual | pos | external
    externalId: varchar("external_id", { length: 80 }),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("menus_restaurant_idx").on(t.restaurantId),
    index("menus_external_idx").on(t.externalId),
    unique("menus_marketplace_id_key").on(t.marketplaceId),
    uniqueIndex("menus_external_key")
      .on(t.restaurantId, t.externalId)
      .where(sql`length(btrim(${t.externalId})) > 0`),
    uniqueIndex("menus_default_idx")
      .on(t.restaurantId)
      .where(sql`${t.isDefault} = true`),
  ],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    // PHASE 31 — optional ownership pointer so a menus row (the POS/chain menu
    // integration container) can own items. NULL preserves the existing
    // restaurant_id fallback, so nothing below this phase changes behavior.
    menuId: integer("menu_id").references(() => menus.id, {
      onDelete: "set null",
    }),
    // PHASE 31 — external POS/chain menu-item id for future menu sync mapping.
    externalId: varchar("external_id", { length: 80 }),
    // PHASE 34 — permanent marketplace identity (e.g. "item_82931"), mirroring
    // restaurants.marketplace_id so future POS sync can reference a dish
    // without exposing the serial id.
    marketplaceId: varchar("marketplace_id", { length: 24 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    imageUrl: text("image_url").notNull().default(""),
    isAvailable: boolean("is_available").notNull().default(true),
    isPopular: boolean("is_popular").notNull().default(false),
    isVegetarian: boolean("is_vegetarian").notNull().default(false),
  },
  (t) => [
    index("menu_items_restaurant_idx").on(t.restaurantId),
    index("menu_items_menu_idx").on(t.menuId),
    index("menu_items_external_idx").on(t.externalId),
    unique("menu_items_marketplace_id_key").on(t.marketplaceId),
    uniqueIndex("menu_items_external_key")
      .on(t.restaurantId, t.externalId)
      .where(sql`length(btrim(${t.externalId})) > 0`),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 200 }),
    phone: varchar("phone", { length: 40 }),
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("customers_phone_key").on(t.phone),
    unique("customers_email_key").on(t.email),
  ],
);

/**
 * Platform operators. Per-user admin accounts with a role; the shared
 * ADMIN_PASSWORD fallback is retained only transiently for bootstrapping.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 200 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    passwordHash: varchar("password_hash", { length: 200 }).notNull(),
    role: varchar("role", { length: 40 }).notNull().default("operator"),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("admin_users_email_key").on(t.email)],
);

// ---------------------------------------------------------------------------
// PHASE 2 — MARKETPLACE PROFILE (new, 1:1 satellite of restaurants)
//
// Holds ONLY what the POS has no concept of: listing state, moderation status,
// fulfilment toggles and delivery economics. Fields that already exist on
// `restaurants` (cuisine, price_range, description, cover image) are NOT
// duplicated here — instead there are nullable *_override columns which fall
// back to the POS value when null.
// ---------------------------------------------------------------------------

export const marketplaceProfiles = pgTable(
  "restaurant_marketplace_profiles",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),

    // Listing / moderation
    isListed: boolean("is_listed").notNull().default(false),
    marketplaceStatus: varchar("marketplace_status", { length: 24 })
      .notNull()
      .default("draft"), // draft | pending_review | live | suspended
    isFeatured: boolean("is_featured").notNull().default(false),

    // Marketplace-only branding (no POS equivalent)
    logoUrl: text("logo_url").notNull().default(""),
    tagline: varchar("tagline", { length: 200 }).notNull().default(""),

    // Existing restaurant POS/customer ordering page. The marketplace never
    // creates the order itself — ORDER ONLINE deep-links to this URL.
    menuUrl: text("menu_url").notNull().default(""),

    // POS bridge credential (Phase 12) — kept for future integrations, but
    // the marketplace no longer authors orders through this bridge.
    posKeyHash: varchar("pos_key_hash", { length: 128 })
      .notNull()
      .default(""),

    // Overrides — null means "inherit from the POS restaurant record"
    descriptionOverride: text("description_override"),
    coverImageOverride: text("cover_image_override"),

    // Restaurant's own QR code image (uploaded by the owner from their POS)
    qrImageUrl: text("qr_image_url"),

    // Fulfilment capabilities
    acceptOnlineOrders: boolean("accept_online_orders").notNull().default(true),
    acceptDelivery: boolean("accept_delivery").notNull().default(true),
    acceptPickup: boolean("accept_pickup").notNull().default(true),

    // Delivery economics (moved off `restaurants` — marketplace concern)
    deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    minOrder: numeric("min_order", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    etaMinutes: integer("eta_minutes").notNull().default(30),
    pickupEtaMinutes: integer("pickup_eta_minutes").notNull().default(15),
    commissionRate: numeric("commission_rate", { precision: 5, scale: 2 })
      .notNull()
      .default("12.00"),

    listedAt: timestamp("listed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("marketplace_profiles_restaurant_key").on(t.restaurantId),
    index("marketplace_profiles_listed_idx").on(t.isListed),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 31 — RESTAURANT LOCATIONS (physical-address directory).
//
// `restaurants` stays the POS record (name, address, coords). This satellite
// lists every physical location the marketplace can serve from. The primary
// row is materialized from the restaurant's own address/coords once on insert
// (a projection, not a second authoritative copy). `external_id` maps to a POS
// location id when a connection is plugged in later.
// ---------------------------------------------------------------------------

export const restaurantLocations = pgTable(
  "restaurant_locations",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull().default("Primary"),
    address: varchar("address", { length: 240 }).notNull().default(""),
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    phone: varchar("phone", { length: 40 }).notNull().default(""),
    isPrimary: boolean("is_primary").notNull().default(false),
    externalId: varchar("external_id", { length: 80 }),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("restaurant_locations_restaurant_idx").on(t.restaurantId),
    uniqueIndex("restaurant_locations_primary_idx")
      .on(t.restaurantId)
      .where(sql`${t.isPrimary} = true`),
  ],
);

// ---------------------------------------------------------------------------
// ORDERS — POS-owned, EXTENDED for the marketplace channel.
// Phase 2 adds a real customer_id FK (stop duplicating the POS customer
// directory as loose text) and a fulfilment type.
// ---------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    reference: varchar("reference", { length: 24 }).notNull().unique(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    customerName: varchar("customer_name", { length: 160 }).notNull(),
    customerPhone: varchar("customer_phone", { length: 40 }).notNull(),
    customerAddress: varchar("customer_address", { length: 260 })
      .notNull()
      .default(""),
    // PHASE 30 — dropoff coordinates captured at checkout (live rider tracking).
    dropoffLat: numeric("dropoff_lat", { precision: 9, scale: 6 }),
    dropoffLng: numeric("dropoff_lng", { precision: 9, scale: 6 }),
    channel: varchar("channel", { length: 24 }).notNull().default("marketplace"),
    fulfillmentType: varchar("fulfillment_type", { length: 16 })
      .notNull()
      .default("delivery"), // delivery | pickup
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    paymentMethod: varchar("payment_method", { length: 24 })
      .notNull()
      .default("cash"),
    paymentStatus: varchar("payment_status", { length: 24 })
      .notNull()
      .default("unpaid"),
    subtotal: numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
    // Tax + discount are POS concepts; the marketplace passes them through.
    taxAmount: numeric("tax_amount", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    discountCode: varchar("discount_code", { length: 40 }),
    discountAmount: numeric("discount_amount", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 10, scale: 2 }).notNull(),
    notes: text("notes").notNull().default(""),
    // POS lifecycle timestamps (Phase 13 + Phase 9 contract). The marketplace
    // reflects these.
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // PHASE 9 — contract timestamps for the states that replaced `completed`
    // (ready → picked_up → delivered) and the PLACED → REJECTED edge.
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // PHASE 32 — scheduled delivery window chosen at checkout. NULL = ASAP.
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    // PHASE 16 — POS delivery tracking. When an order is placed from the
    // marketplace, the outbox queues it for the restaurant's POS. These columns
    // track that delivery lifecycle independently of the order's own status.
    posDeliveryStatus: varchar("pos_delivery_status", { length: 20 })
      .notNull()
      .default("pending"), // pending | queued | delivering | delivered | failed
    posDeliveryAttempts: integer("pos_delivery_attempts").notNull().default(0),
    posLastDeliveryError: text("pos_last_delivery_error").notNull().default(""),
    posDeliveredAt: timestamp("pos_delivered_at", { withTimezone: true }),
    // PHASE 19 — the POS's own order reference, captured from inbound webhooks.
    // null = the POS has not yet reported one (or is not connected).
    externalOrderId: varchar("external_order_id", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("orders_restaurant_idx").on(t.restaurantId),
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
    index("orders_scheduled_idx").on(t.scheduledFor),
    index("orders_pos_delivery_idx").on(t.posDeliveryStatus),
  ],
);

/**
 * PHASE 13 — an append-only audit trail of every lifecycle transition. This is
 * what both the POS queue AND the customer tracker render from, so the two
 * screens can never disagree.
 */
export const orderStatusEvents = pgTable(
  "order_status_events",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: varchar("from_status", { length: 24 }),
    toStatus: varchar("to_status", { length: 24 }).notNull(),
    actor: varchar("actor", { length: 24 }).notNull().default("pos"), // pos | customer | system
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("order_status_events_order_idx").on(t.orderId),
    index("order_status_events_to_idx").on(t.toStatus, t.createdAt),
  ],
);

/**
 * PHASE 10 — unified, append-only ORDER event audit trail.
 *
 * This is a SUPERSET of `order_status_events`: every lifecycle transition is
 * recorded here AND domain/milestone events that aren't status changes
 * (PAYMENT_CONFIRMED, ORDER_SENT_TO_RESTAURANT, DELIVERY_ASSIGNED, rider leg,
 * refunds). One chronological event list per order = the debugging surface for
 * the marketplace/POS integration. `type` is the machine-readable uppercase
 * key (ORDER_PLACED, PREPARING, READY, …); `meta` is a free-form JSON payload
 * (payment ids, amounts, partner ids) so nothing is lost when diagnosing.
 */
export const orderEvents = pgTable(
  "order_events",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(),
    actor: varchar("actor", { length: 24 }).notNull().default("system"), // system | pos | customer | payment | rider
    fromStatus: varchar("from_status", { length: 24 }),
    toStatus: varchar("to_status", { length: 24 }),
    meta: text("meta").notNull().default("{}"), // JSON payload, see PHASE 10 above
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("order_events_order_idx").on(t.orderId, t.createdAt),
    index("order_events_type_idx").on(t.type),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    menuItemId: integer("menu_item_id").references(() => menuItems.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 160 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    // JSON snapshot of the modifier selections at the moment of ordering.
    // Structure: [{ groupId, name, modifiers: [{ id, name, priceDelta }] }]
    modifiers: text("modifiers").notNull().default("[]"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// ---------------------------------------------------------------------------
// REVIEWS — EXTENDED (not replaced).
// Phase 2 adds customer_id + order_id so a review can be tied to a real
// purchase, plus a derived is_verified flag. `comment` is the review_text
// column; it is NOT renamed, to avoid churning an existing structure.
// ---------------------------------------------------------------------------

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    customerName: varchar("customer_name", { length: 160 }).notNull(),
    rating: integer("rating").notNull().default(5),
    comment: text("comment").notNull().default(""),
    isVerified: boolean("is_verified").notNull().default(false),
    // PHASE 14 — moderation + restaurant response.
    moderationStatus: varchar("moderation_status", { length: 16 })
      .notNull()
      .default("published"), // published | pending | hidden
    response: text("response").notNull().default(""),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("reviews_restaurant_idx").on(t.restaurantId),
    index("reviews_order_idx").on(t.orderId),
    index("reviews_moderation_idx").on(t.moderationStatus),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 9 — MODIFIERS (POS-native)
//
// A modifier group belongs to a menu_item and holds one or more modifiers.
// Groups declare min/max selections; modifiers carry a price delta that the
// POS applies when ringing up the ticket. The marketplace re-uses these same
// rows — it never invents a second set.
// ---------------------------------------------------------------------------

export const menuItemModifierGroups = pgTable(
  "menu_item_modifier_groups",
  {
    id: serial("id").primaryKey(),
    menuItemId: integer("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("modifier_groups_item_idx").on(t.menuItemId)],
);

export const menuItemModifiers = pgTable(
  "menu_item_modifiers",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => menuItemModifierGroups.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    priceDelta: numeric("price_delta", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("modifiers_group_idx").on(t.groupId)],
);

// ---------------------------------------------------------------------------
// PHASE 9 — DISCOUNTS (POS-native promo codes)
// ---------------------------------------------------------------------------

export const discounts = pgTable(
  "discounts",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    kind: varchar("kind", { length: 12 }).notNull().default("percent"), // percent | flat
    value: numeric("value", { precision: 10, scale: 2 }).notNull(),
    minSubtotal: numeric("min_subtotal", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    isActive: boolean("is_active").notNull().default(true),
    // PHASE 20 — public restaurant offers (vs code-only POS promos).
    isPublic: boolean("is_public").notNull().default(false),
    title: varchar("title", { length: 80 }).notNull().default(""),
    freeMenuItemId: integer("free_menu_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("discounts_restaurant_code_key").on(t.restaurantId, t.code)],
);

// ---------------------------------------------------------------------------
// PHASE 10 — CUSTOMER IDENTITY
//
// customers already exists in the POS. We extend it with a display name
// (already there), add a saved address book, saved-restaurant bookmarks and
// OTP challenges. Sessions are HTTP-only cookies, not stored server-side, so
// there is no `sessions` table.
// ---------------------------------------------------------------------------

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 40 }).notNull().default("Home"),
    line: varchar("line", { length: 260 }).notNull(),
    // PHASE 30 — saved-address coordinates so checkout can reuse them.
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customer_addresses_customer_idx").on(t.customerId)],
);

export const savedRestaurants = pgTable(
  "saved_restaurants",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("saved_restaurants_unique").on(t.customerId, t.restaurantId),
    index("saved_restaurants_customer_idx").on(t.customerId),
  ],
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 200 }).notNull(),
    codeHash: varchar("code_hash", { length: 128 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("otp_challenges_email_idx").on(t.email)],
);

// ---------------------------------------------------------------------------
// PHASE 20 — LOYALTY LEDGER (append-only).
// customers.loyalty_points is the running balance; this table is the audit
// trail. 10 Tablz points per $10 spent.
// ---------------------------------------------------------------------------

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    points: integer("points").notNull(),
    reason: varchar("reason", { length: 80 }).notNull().default("earn"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("loyalty_ledger_customer_idx").on(t.customerId)],
);

// ---------------------------------------------------------------------------
// PHASE 21 — NOTIFICATIONS outbox.
// The POS and marketplace both enqueue; the outbox is the single source of
// truth and a Phase 24 worker can flush to real Push / WhatsApp / SMS / Email.
// ---------------------------------------------------------------------------

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    phone: varchar("phone", { length: 40 }).notNull(),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "cascade",
    }),
    kind: varchar("kind", { length: 32 }).notNull(),
    message: text("message").notNull(),
    channel: varchar("channel", { length: 16 }).notNull().default("push"),
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    meta: text("meta").notNull().default("{}"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_order_idx").on(t.orderId),
    index("notifications_customer_idx").on(t.customerId),
    index("notifications_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 23 — IDEMPOTENCY (exactly-once payment + order processing).
// ---------------------------------------------------------------------------

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: varchar("key", { length: 80 }).primaryKey(),
    customerId: integer("customer_id"),
    reference: varchar("reference", { length: 24 }),
    responseStatus: integer("response_status").notNull().default(0),
    responseBody: text("response_body").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idempotency_keys_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------------------
// PHASE 17 — REVIEW REPORTS (operator moderation queue).
// ---------------------------------------------------------------------------

export const reviewReports = pgTable(
  "review_reports",
  {
    id: serial("id").primaryKey(),
    reviewId: integer("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 80 }).notNull().default("inappropriate"),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("review_reports_review_idx").on(t.reviewId)],
);

// ---------------------------------------------------------------------------
// PHASE 24 — PUSH SUBSCRIPTIONS (Web Push / Push API).
// Each authenticated customer can have multiple device subscriptions (one row
// per PushSubscription). A label distinguishes e.g. "Chrome on Desktop" from
// "Android Chrome". The delivery worker looks these up by customerId when
// flushing the notifications outbox.
// ---------------------------------------------------------------------------

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    label: varchar("label", { length: 40 }).notNull().default("browser"),
    // Internal delivery bookkeeping.
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("push_subscriptions_customer_idx").on(t.customerId),
    index("push_subscriptions_endpoint_idx").on(t.endpoint),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 24 — PAYMENTS (Razorpay audit trail).
// Every payment attempt — success, failure, or refund — is recorded here.
// The orders.payment_status column is a denormalized summary derived from
// this table for fast reads.
//
// orderId is NULL until the payment is verified — the marketplace order is
// created only after a captured payment, so the intent row is linked by
// `reference` (the order reference assigned at intent time) before the order
// row exists.
// ---------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    reference: varchar("reference", { length: 24 })
      .notNull()
      .unique(),
    razorpayOrderId: varchar("razorpay_order_id", { length: 64 }).notNull(),
    razorpayPaymentId: varchar("razorpay_payment_id", { length: 64 }),
    razorpaySignature: varchar("razorpay_signature", { length: 128 }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    status: varchar("status", { length: 24 })
      .notNull()
      .default("created"), // created | authorized | captured | failed | refunded | partial_refunded
    failureReason: text("failure_reason"),
    refundId: varchar("refund_id", { length: 64 }),
    refundAmount: numeric("refund_amount", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("payments_order_idx").on(t.orderId),
    index("payments_razorpay_order_idx").on(t.razorpayOrderId),
    index("payments_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 29 — DELIVERY PARTNERS (dispatch directory).
// Platform-level riders who fulfill marketplace `delivery` orders. A partner
// is either available, busy with an active assignment, or offline. `rating`
// and `total_deliveries` accumulate across delivered assignments.
// ---------------------------------------------------------------------------

export const deliveryPartners = pgTable(
  "delivery_partners",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 40 }).notNull(),
    vehicleType: varchar("vehicle_type", { length: 24 })
      .notNull()
      .default("bike"), // bike | scooter | car | walking
    status: varchar("status", { length: 24 })
      .notNull()
      .default("available"), // available | busy | offline
    active: boolean("active").notNull().default(true),
    totalDeliveries: integer("total_deliveries").notNull().default(0),
    rating: numeric("rating", { precision: 3, scale: 2 })
      .notNull()
      .default("5.00"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("delivery_partners_phone_key").on(t.phone),
    index("delivery_partners_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 4 — DELIVERY ENGINE (the decoupled delivery track).
//
// `orders.status` stays the FOOD lifecycle (placed → accepted → preparing →
// ready). Delivery-only states live here, on `delivery_orders`, so the POS
// kitchen flow is never crammed with rider states:
//
//   FOOD      placed → accepted → preparing → ready
//   DELIVERY  pending_assignment → assigned → accepted → at_restaurant
//             → picked_up → out_for_delivery → arriving → delivered
//             (… → failed / cancelled)
//
// One `delivery_orders` row per delivery order (unique order_id).
// ---------------------------------------------------------------------------

export const deliveryOrders = pgTable(
  "delivery_orders",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    // The authoritative delivery lifecycle (src/lib/delivery-lifecycle.ts).
    deliveryStatus: varchar("delivery_status", { length: 24 })
      .notNull()
      .default("pending_assignment"),
    // How the food travels: platform (marketplace fleet) | restaurant_rider
    // (the restaurant's own staff) | external (3rd-party provider) | tablz.
    deliveryMode: varchar("delivery_mode", { length: 24 })
      .notNull()
      .default("platform"),
    deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 })
      .notNull()
      .default("0"),
    pickupLat: numeric("pickup_lat", { precision: 9, scale: 6 }),
    pickupLng: numeric("pickup_lng", { precision: 9, scale: 6 }),
    dropoffLat: numeric("dropoff_lat", { precision: 9, scale: 6 }),
    dropoffLng: numeric("dropoff_lng", { precision: 9, scale: 6 }),
    estimatedPickupAt: timestamp("estimated_pickup_at", { withTimezone: true }),
    estimatedDeliveryAt: timestamp("estimated_delivery_at", {
      withTimezone: true,
    }),
    // External dispatch keys (provider integrations, e.g. a 3rd-party fleet).
    provider: varchar("provider", { length: 40 }).notNull().default(""),
    providerDeliveryId: varchar("provider_delivery_id", { length: 80 })
      .notNull()
      .default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("delivery_orders_order_key").on(t.orderId),
    index("delivery_orders_restaurant_idx").on(t.restaurantId),
    index("delivery_orders_status_idx").on(t.deliveryStatus),
  ],
);

/** PHASE 45 — per-restaurant rider directory (own rider / restaurant staff). */
export const deliveryRiders = pgTable(
  "delivery_riders",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    phone: varchar("phone", { length: 40 }).notNull(),
    vehicleType: varchar("vehicle_type", { length: 24 })
      .notNull()
      .default("bike"), // bike | scooter | car | walking
    status: varchar("status", { length: 24 })
      .notNull()
      .default("available"), // available | busy | offline
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("delivery_riders_restaurant_idx").on(t.restaurantId),
    index("delivery_riders_status_idx").on(t.status),
    unique("delivery_riders_restaurant_phone_key").on(t.restaurantId, t.phone),
  ],
);

/**
 * PHASE 29 — one active delivery assignment per order (enforced by the unique
 * order_id key). Establishes a POS-assigned partner for a marketplace delivery
 * order and tracks the rider sub-progress:
 *
 *   assigned → accepted → arriving → picked_up → delivered
 *   assigned → cancelled
 *
 * PHASE 45 — evolved: `provider` names the fleet, `rider_id` links a
 * restaurant-owned rider, and `delivery_order_id` ties the assignment to the
 * decoupled delivery track above. The platform flow (partner_id + token) keeps
 * working unchanged; old rows keep NULLs.
 *
 * The assignment is a parallel track to the kitchen lifecycle: `delivered`
 * completes the order (via the existing lifecycle). `token` is the credential
 * a rider uses to advance the assignment without a session — same pattern as
 * the public order reference.
 *
 *   assigned → accepted → arriving → picked_up → delivered
 *   assigned → cancelled
 *
 * The assignment is a parallel track to the kitchen lifecycle: `delivered`
 * completes the order (via the existing lifecycle). `token` is the credential
 * a rider uses to advance the assignment without a session — same pattern as
 * the public order reference.
 */
export const deliveryAssignments = pgTable(
  "delivery_assignments",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    partnerId: integer("partner_id").references(() => deliveryPartners.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 24 })
      .notNull()
      .default("assigned"),
    token: varchar("token", { length: 40 }).notNull(),
    // PHASE 45 — the delivery track this assignment drives (nullable for
    // legacy rows created before delivery_orders existed).
    deliveryOrderId: integer("delivery_order_id").references(
      () => deliveryOrders.id,
      { onDelete: "set null" },
    ),
    // PHASE 45 — fleet provenance + restaurant-owned rider link. The
    // platform flow keeps using partner_id; restaurant_rider mode uses rider_id.
    provider: varchar("provider", { length: 24 })
      .notNull()
      .default("platform"), // platform | restaurant_rider | external | tablz
    riderId: integer("rider_id").references(() => deliveryRiders.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    // PHASE 30 — latest rider position fix (live tracking). The rider app
    // reports lat/lng/heading; `location_updated_at` drives staleness + rate
    // limiting. Null until the first fix is reported.
    riderLat: numeric("rider_lat", { precision: 9, scale: 6 }),
    riderLng: numeric("rider_lng", { precision: 9, scale: 6 }),
    riderHeading: numeric("rider_heading", { precision: 5, scale: 2 }),
    locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
  },
  (t) => [
    unique("delivery_assignments_order_key").on(t.orderId),
    unique("delivery_assignments_token_key").on(t.token),
    index("delivery_assignments_partner_idx").on(t.partnerId),
    index("delivery_assignments_location_idx").on(t.locationUpdatedAt),
    uniqueIndex("delivery_assignments_delivery_order_key")
      .on(t.deliveryOrderId)
      .where(sql`${t.deliveryOrderId} is not null`),
    index("delivery_assignments_rider_idx").on(t.riderId),
  ],
);

/**
 * PHASE 45 — rider position history. The matching latest-fix columns on
 * `delivery_assignments` (rider_lat/rider_lng/rider_heading) stay as the cheap
 * current-position read; this table is the append-only motion trail (distance,
 * ETA and playback can be derived from it). One row per reported tick.
 */
export const riderLocations = pgTable(
  "rider_locations",
  {
    id: serial("id").primaryKey(),
    deliveryOrderId: integer("delivery_order_id").references(
      () => deliveryOrders.id,
      { onDelete: "cascade" },
    ),
    riderId: integer("rider_id").references(() => deliveryRiders.id, {
      onDelete: "set null",
    }),
    partnerId: integer("partner_id").references(() => deliveryPartners.id, {
      onDelete: "set null",
    }),
    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),
    heading: numeric("heading", { precision: 5, scale: 2 }),
    speed: numeric("speed", { precision: 6, scale: 2 }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rider_locations_delivery_order_idx").on(
      t.deliveryOrderId,
      t.recordedAt,
    ),
    index("rider_locations_rider_idx").on(t.riderId),
  ],
);

/**
 * PHASE 45 — delivery-track audit trail (parallel to order_events, which stays
 * kitchen/order-scoped). Append-only: every delivery milestone a rider,
 * dispatcher or provider integration advances lands here.
 */
export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: serial("id").primaryKey(),
    deliveryOrderId: integer("delivery_order_id").references(
      () => deliveryOrders.id,
      { onDelete: "cascade" },
    ),
    eventType: varchar("event_type", { length: 40 }).notNull(),
    actor: varchar("actor", { length: 24 })
      .notNull()
      .default("system"), // system | pos | rider | customer | provider
    metadata: text("metadata").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("delivery_events_delivery_order_idx").on(t.deliveryOrderId, t.createdAt),
    index("delivery_events_type_idx").on(t.eventType),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 31 — RESTAURANT INTEGRATIONS (the integration record).
//
// One row per restaurant — the marketplace's contract with that business: how
// it connects (manual today, POS API later), its connection status, the
// credential hash used to authenticate its POS, health + last-sync bookkeeping.
// The actual POS connection is plugged in later; this phase ONLY maintains the
// reliable record. `api_key_hash` is a SHA-256 (same convention as
// restaurant_marketplace_profiles.posKeyHash), never the raw key.
// ---------------------------------------------------------------------------

export const restaurantIntegrations = pgTable(
  "restaurant_integrations",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 24 })
      .notNull()
      .default("manual"), // manual | pos_openapi | external
    status: varchar("status", { length: 24 })
      .notNull()
      .default("disconnected"), // disconnected | connecting | connected | error | disabled
    externalRestaurantId: varchar("external_restaurant_id", { length: 80 }),
    endpointUrl: text("endpoint_url").notNull().default(""),
    apiKeyHash: varchar("api_key_hash", { length: 128 }).notNull().default(""),
    // PHASE 12 — raw API key for outbound Marketplace → RestaurantAI calls.
    // The hash is for RestaurantAI to verify; the raw is for the marketplace
    // to present. Shown once at rotation; stored here so the dispatcher can
    // include it in outbound headers. Never exposed to any frontend.
    apiKeyRaw: text("api_key_raw").notNull().default(""),
    // First chars of the key, for human-readable display only.
    apiKeyPrefix: varchar("api_key_prefix", { length: 12 })
      .notNull()
      .default(""),
    // PHASE 33 — webhook signing secret. Verifies the POS and signs outbound
    // webhook requests. Generated at integration-record creation, never the raw
    // API key. The POS presents it alongside the connection code to authorize.
    webhookSecret: varchar("webhook_secret", { length: 64 })
      .notNull()
      .default(""),
    capabilities: text("capabilities").notNull().default("{}"), // JSON: {orders,menu,payments}
    config: text("config").notNull().default("{}"), // JSON: poll interval, version, locale
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    // PHASE 33 — when the integration settled into `connected`. NULL unless the
    // restaurant is currently connected, cleared on disconnect/error.
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastError: text("last_error").notNull().default(""),
    healthStatus: varchar("health_status", { length: 16 })
      .notNull()
      .default("unknown"), // unknown | healthy | degraded | down
    version: varchar("version", { length: 24 }).notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("restaurant_integrations_restaurant_key").on(t.restaurantId),
    index("restaurant_integrations_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 31 — WEBHOOK EVENTS (outbound integration outbox).
//
// Append-only outbox of events to deliver to a restaurant's POS endpoint URL
// (order placed, status changed, payment captured, menu sync …). A Phase 32+
// dispatch worker will read `pending`/`retrying` rows and target
// restaurant_integrations.endpoint_url. `order_status_events` remains the
// single append-only source of truth for lifecycle; this table is the delivery
// queue, not a duplicate domain log.
// ---------------------------------------------------------------------------

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    integrationId: integer("integration_id").references(
      () => restaurantIntegrations.id,
      { onDelete: "set null" },
    ),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    // PHASE 13 — sender's unique event ID for inbound dedup. NULL for legacy
    // outbound rows; a unique constraint prevents double-processing.
    eventId: varchar("event_id", { length: 128 }),
    // PHASE 13 — 'outbound' (marketplace → POS, existing) or 'inbound'
    // (POS → marketplace, new unified receiver).
    direction: varchar("direction", { length: 8 })
      .notNull()
      .default("outbound"), // outbound | inbound
    payload: text("payload").notNull().default("{}"),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("pending"), // pending | retrying | success | failed | expired | received | processed
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastHttpStatus: integer("last_http_status"),
    lastError: text("last_error").notNull().default(""),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("webhook_events_outbox_idx").on(t.status, t.nextAttemptAt),
    index("webhook_events_restaurant_idx").on(t.restaurantId),
    index("webhook_events_order_idx").on(t.orderId),
    index("webhook_events_integration_idx").on(t.integrationId),
  ],
);

// ---------------------------------------------------------------------------
// PHASE 17 — IDEMPOTENCY STORE.
//
// Records processed (scope, key) from inbound integration requests so a
// network-induced retry returns the cached response instead of re-running the
// side effect. Used by the marketplace's own inbound receiver and the fake POS
// (reference RestaurantAI implementation). Unique (scope, idempotency_key).
// ---------------------------------------------------------------------------

export const integrationIdempotency = pgTable(
  "integration_idempotency",
  {
    id: serial("id").primaryKey(),
    scope: varchar("scope", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 191 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    response: text("response").notNull().default("{}"),
    statusCode: integer("status_code").notNull().default(200),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("integration_idempotency_scope_key_uniq").on(t.scope, t.idempotencyKey),
  ],
);

export type IntegrationIdempotency = typeof integrationIdempotency.$inferSelect;

// ---------------------------------------------------------------------------
// MEDIA — restaurant-uploaded images (Phase 4 onboarding).
// Stored in Postgres and served through /api/media/[id] so uploads survive
// production rebuilds where the filesystem is not persistent.
// ---------------------------------------------------------------------------

export const mediaAssets = pgTable("media_assets", {
  id: serial("id").primaryKey(),
  mimeType: varchar("mime_type", { length: 64 }).notNull().default("image/jpeg"),
  byteSize: integer("byte_size").notNull().default(0),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type Restaurant = typeof restaurants.$inferSelect;
export type MarketplaceProfile = typeof marketplaceProfiles.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type OrderStatusEvent = typeof orderStatusEvents.$inferSelect;
export type MenuItemModifierGroup = typeof menuItemModifierGroups.$inferSelect;
export type MenuItemModifier = typeof menuItemModifiers.$inferSelect;
export type Discount = typeof discounts.$inferSelect;
export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type SavedRestaurant = typeof savedRestaurants.$inferSelect;
export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type LoyaltyLedger = typeof loyaltyLedger.$inferSelect;
export type ReviewReport = typeof reviewReports.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type DeliveryPartner = typeof deliveryPartners.$inferSelect;
export type DeliveryAssignment = typeof deliveryAssignments.$inferSelect;
export type DeliveryOrder = typeof deliveryOrders.$inferSelect;
export type DeliveryRider = typeof deliveryRiders.$inferSelect;
export type RiderLocation = typeof riderLocations.$inferSelect;
export type DeliveryEvent = typeof deliveryEvents.$inferSelect;
export type Menu = typeof menus.$inferSelect;
export type RestaurantLocation = typeof restaurantLocations.$inferSelect;
export type RestaurantIntegration = typeof restaurantIntegrations.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
