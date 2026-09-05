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
} from "drizzle-orm/pg-core";

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
    cuisine: varchar("cuisine", { length: 80 }).notNull(),
    description: text("description").notNull().default(""),
    address: varchar("address", { length: 240 }).notNull().default(""),
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
  (t) => [index("restaurants_cuisine_idx").on(t.cuisine)],
);

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    restaurantId: integer("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("categories_restaurant_idx").on(t.restaurantId)],
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
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    imageUrl: text("image_url").notNull().default(""),
    isAvailable: boolean("is_available").notNull().default(true),
    isPopular: boolean("is_popular").notNull().default(false),
    isVegetarian: boolean("is_vegetarian").notNull().default(false),
  },
  (t) => [index("menu_items_restaurant_idx").on(t.restaurantId)],
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
    // POS lifecycle timestamps (Phase 13). The marketplace reflects these.
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("orders_restaurant_idx").on(t.restaurantId),
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
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
