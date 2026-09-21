import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export interface OrderItemSnapshot {
  menuItemId: number;
  name: string;
  priceCents: number;
  quantity: number;
  imageUrl: string;
  isVeg: boolean;
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
  distanceKm: real("distance_km").notNull().default(2),
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
  ownerKeyHash: text("owner_key_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  },
  (t) => [index("menu_restaurant_idx").on(t.restaurantId)],
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
    instructions: text("instructions").notNull().default(""),
    riderName: text("rider_name").notNull().default("Arjun Mehta"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("orders_phone_idx").on(t.phone)],
);

export type RestaurantRow = typeof restaurants.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type ConnectionCodeRow = typeof connectionCodes.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type IntegrationSessionRow = typeof integrationSessions.$inferSelect;
