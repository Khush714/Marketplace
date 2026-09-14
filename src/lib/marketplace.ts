import { db } from "@/db";
import {
  restaurants,
  marketplaceProfiles,
  categories,
  menuItems,
  menuItemModifierGroups,
  menuItemModifiers,
  menus,
  discounts,
  savedRestaurants,
  reviews,
  orders,
  orderItems,
  orderStatusEvents,
  customers,
  notifications,
} from "@/db/schema";
import { priceCart, type LineInput, type LineModifierSelection, type PricingResult } from "./pricing";
import { summarizeStatus, statusLabel } from "./order-lifecycle";
import { appendOrderEvent, listOrderEvents, type OrderEventView } from "./order-events";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { num, orderReference, currency, shortDateTime } from "./format";
import { flushOrder } from "./push";
import { publishOrderEvent } from "./realtime";
import { haversineKm, parseLatLng, type LatLng } from "./geo";
import { getDeliveryForOrder, type RiderFix } from "./delivery";
import { createDeliveryOrderForOrderTx } from "./delivery";
import { enqueueOutboundEvent } from "./webhook-outbox";
import { marketplaceOrderingEnabled } from "./feature-flags";

// ===========================================================================
// PHASE 3 — CUSTOMER-SAFE CONTRACT
//
// Public payloads are built from an explicit allowlist below. `assertCustomerSafe`
// is a runtime tripwire: if any internal field ever leaks into a response, the
// request fails loudly instead of silently exposing POS data.
// ===========================================================================

const FORBIDDEN_KEYS = new Set([
  // restaurant financials / marketplace commercial terms
  "commissionRate",
  "commission_rate",
  "margin",
  "profit",
  "revenue",
  // inventory & procurement
  "costPrice",
  "cost_price",
  "unitCost",
  "unit_cost",
  "stock",
  "inventory",
  "supplierId",
  "supplier_id",
  "supplier",
  // staff & internal ops
  "staffId",
  "staff_id",
  "staffPin",
  "staff_pin",
  "staff",
  "internalNotes",
  "internal_notes",
  "posConfig",
  "pos_config",
  // internal marketplace administration
  "marketplaceStatus",
  "marketplace_status",
  "isListed",
  "is_listed",
  "isFeatured",
  "is_featured",
  "listedAt",
  "listed_at",
  "updatedAt",
  "updated_at",
  "profileId",
  "profile_id",
  "channel",
  // auth / secrets
  "codeHash",
  "code_hash",
  "otp",
  "sessionToken",
  "session_token",
  // internal relational ids and other customers' PII
  "restaurantId",
  "restaurant_id",
  "categoryId",
  "category_id",
  "menuItemId",
  "menu_item_id",
  "orderId",
  "order_id",
  "customerId",
  "customer_id",
  "customerPhone",
  "customer_phone",
  "customerEmail",
  "customer_email",
]);

/** Throws if an internal/POS-only key appears anywhere in a public payload. */
export function assertCustomerSafe(payload: unknown, path = "$"): void {
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertCustomerSafe(v, `${path}[${i}]`));
    return;
  }
  if (payload && typeof payload === "object") {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) {
        throw new Error(`Customer-unsafe field leaked at ${path}.${k}`);
      }
      assertCustomerSafe(v, `${path}.${k}`);
    }
  }
}

/**
 * PHASE 10 — the raw audit trail (written for POS debugging) may carry internal
 * keys in `meta` (restaurantId, orderId, …). The customer page must never see
 * those, so strip them at the boundary instead of leaking them into a payload.
 */
export function toPublicEventViews(
  events: OrderEventView[],
): OrderEventView[] {
  return events.map((e) => {
    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e.meta)) {
      if (!FORBIDDEN_KEYS.has(k)) meta[k] = v;
    }
    return { ...e, meta };
  });
}

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------

const resolvedDescription = sql<string>`coalesce(nullif(${marketplaceProfiles.descriptionOverride}, ''), ${restaurants.description})`;
const resolvedCover = sql<string>`coalesce(nullif(${marketplaceProfiles.coverImageOverride}, ''), ${restaurants.imageUrl})`;

// PHASE 14 — ratings only count PUBLISHED reviews, and verified reviews are
// weighted above unverified (verified × 1, unverified × 0.5). This is the
// "weighted / average verified ratings" the marketplace computes for the card
// and storefront, across every aggregation.
const publishedReviewFilter = sql`(${reviews.moderationStatus} = 'published')`;
const weightedRatingExpr = sql<number>`coalesce(
  sum(${reviews.rating} * case when ${reviews.isVerified} then 1.0 else 0.5 end) filter (where ${reviews.moderationStatus} = 'published')
  / nullif(sum(case when ${reviews.isVerified} then 1.0 else 0.5 end) filter (where ${reviews.moderationStatus} = 'published'), 0),
  0)`;
const publishedCountExpr = sql<number>`count(${reviews.id}) filter (where ${reviews.moderationStatus} = 'published')`;

/** A restaurant is consumer-visible only when its profile says so. */
export const listedCondition = and(
  eq(marketplaceProfiles.isListed, true),
  eq(marketplaceProfiles.marketplaceStatus, "live"),
);

// ---------------------------------------------------------------------------
// Public shapes (allowlists — nothing else is serialised)
// ---------------------------------------------------------------------------

export type SortKey = "recommended" | "rating" | "popular" | "nearby" | "name";

export type PublicRestaurant = {
  id: number;
  /** PHASE 32 — permanent marketplace identity (e.g. "rst_01j8abc123"). */
  marketplaceId: string;
  slug: string;
  name: string;
  cuisine: string;
  /** `cuisine` split for display, e.g. "Indian • Chinese". */
  cuisines: string[];
  description: string;
  tagline: string;
  imageUrl: string;
  logoUrl: string;
  /** Restaurant POS ordering URL. Marketplace deep-links here only in
   * discovery-only mode; when `ordersInternal` is true the marketplace takes
   * the order itself. */
  menuUrl: string;
  /**
   * True when in-marketplace ordering is reactivated (MARKETPLACE_ORDERING_ENABLED=1):
   * the customer orders through the marketplace's own menu/checkout page instead
   * of deep-linking to the restaurant's hosted URL.
   */
  ordersInternal: boolean;
  /** Owner-uploaded image of their existing POS menu QR code. */
  qrImageUrl: string;
  priceRange: string;
  address: string;
  rating: number;
  reviewCount: number;
  etaMinutes: number;
  pickupEtaMinutes: number;
  deliveryFee: number;
  minOrder: number;
  /** POS-native tax rate (e.g. 0.0875). Exposed so cart preview matches server. */
  taxRate: number;
  isOpen: boolean;
  featured: boolean;
  vegetarian: boolean;
  lat: number | null;
  lng: number | null;
  deliveryRadiusKm: number;
  /** Populated when the customer shares a location. */
  distanceKm: number | null;
  deliversToYou: boolean | null;
  offers: PublicOffer[];
  accepts: {
    onlineOrders: boolean;
    delivery: boolean;
    pickup: boolean;
  };
};

export type PublicOffer = {
  code: string;
  title: string;
  kind: "percent" | "flat" | "free_item";
  value: number;
  minSubtotal: number;
  freeItemName: string | null;
};

export type PublicModifier = {
  id: number;
  name: string;
  priceDelta: number;
  available: boolean;
};

export type PublicModifierGroup = {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: PublicModifier[];
};

export type PublicMenuItem = {
  id: number;
  /** PHASE 34 — stable marketplace id ("item_…", e.g. "item_82931") the future
   * RestaurantAI menu sync will reference instead of the serial id. */
  menuItemId: string;
  /** PHASE 35 — external RestaurantAI/POS id ("pos_item_829") this item is
   * mapped to, if the restaurant has registered it. null = marketplace-only. */
  externalId: string | null;
  /** PHASE 34 — stable category id ("cat_…") this item belongs to, if any. */
  categoryId: string | null;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  available: boolean;
  popular: boolean;
  vegetarian: boolean;
  category: string;
  modifierGroups: PublicModifierGroup[];
};

export type PublicMenu = {
  restaurant: PublicRestaurant;
  /** PHASE 19 — permanent marketplace id of the restaurant's active menu (e.g. "menu_01J8abc123"). */
  menuId: string;
  categories: { id: string; name: string; items: PublicMenuItem[] }[];
};

export type PublicReview = {
  id: number;
  author: string;
  rating: number;
  comment: string;
  verified: boolean;
  createdAt: string;
  /** PHASE 14 — restaurant's reply, if any. */
  response: string;
  respondedAt: string | null;
};

export type PublicOrderItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: LineModifierSelection[];
  /** Same public id the menu endpoint exposes (`id`); null if the dish was removed. */
  itemId: number | null;
};

export type PublicOrder = {
  id: number;
  reference: string;
  status: string;
  rawStatus: string;
  /** PHASE 8 — order source/channel (e.g. "marketplace"). Maps orders.channel. */
  source: string;
  fulfillment: "delivery" | "pickup";
  payment: { method: string; status: string };
  customer: { name: string; address: string };
  restaurant: {
    id: number;
    /** PHASE 32 — stable marketplace identity for the order's restaurant. */
    marketplaceId: string;
    name: string;
    slug: string;
    /** PHASE 30 — pickup pin for the rider map (null if unset). */
    lat: number | null;
    lng: number | null;
  };
  totals: {
    subtotal: number;
    discount: number;
    discountCode: string | null;
    tax: number;
    deliveryFee: number;
    total: number;
  };
  items: PublicOrderItem[];
  /** PHASE 13 — canonical lifecycle reflected straight from the POS. */
  lifecycle: {
    status: string;
    label: string;
    step: number;
    terminal: boolean;
    next: string[];
  };
  /** PHASE 13 — append-only audit trail both screens render from. */
  timeline: { status: string; label: string; at: string; actor: string }[];
  /**
   * PHASE 10 — unified audit trail (superset of `timeline`): lifecycle
   * transitions AND domain milestones (payment, sent-to-restaurant, delivery).
   * Chronological, oldest first; the debugging surface for POS integration.
   */
  events: OrderEventView[];
  /**
   * PHASE 29/30 — rider snapshot for delivery orders (null until assigned).
   * `dropoff` is the coords captured at checkout (null for legacy/`pickup`);
   * `rider` is the latest live position fix (null until the rider reports in).
   */
  delivery: {
    status: string;
    label: string;
    step: number;
    terminal: boolean;
    partner: { id: number; name: string; vehicleType: string } | null;
    dropoff: LatLng | null;
    rider: RiderFix | null;
  } | null;
  /** PHASE 14 — a review is only possible once the order is delivered. */
  review: {
    eligible: boolean;
    reason: string | null;
    alreadyReviewed: boolean;
  };
  /** PHASE 32 — future delivery window (ISO, null = ASAP/regular order). */
  scheduledFor: string | null;
  placedAt: string;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const publicRestaurantColumns = {
  id: restaurants.id,
  marketplaceId: restaurants.marketplaceId,
  slug: restaurants.slug,
  name: restaurants.name,
  cuisine: restaurants.cuisine,
  description: resolvedDescription,
  tagline: marketplaceProfiles.tagline,
  imageUrl: resolvedCover,
  logoUrl: marketplaceProfiles.logoUrl,
  // NEW — deep link to the existing restaurant POS ordering page.
  menuUrl: marketplaceProfiles.menuUrl,
  qrImageUrl: marketplaceProfiles.qrImageUrl,
  priceRange: restaurants.priceRange,
  address: restaurants.address,
  etaMinutes: marketplaceProfiles.etaMinutes,
  pickupEtaMinutes: marketplaceProfiles.pickupEtaMinutes,
  deliveryFee: marketplaceProfiles.deliveryFee,
  minOrder: marketplaceProfiles.minOrder,
  taxRate: restaurants.taxRate,
  isOpen: restaurants.isOpen,
  featured: marketplaceProfiles.isFeatured,
  acceptOnlineOrders: marketplaceProfiles.acceptOnlineOrders,
  acceptDelivery: marketplaceProfiles.acceptDelivery,
  acceptPickup: marketplaceProfiles.acceptPickup,
  lat: restaurants.lat,
  lng: restaurants.lng,
  deliveryRadiusKm: restaurants.deliveryRadiusKm,
};

type RawRestaurant = {
  id: number;
  marketplaceId: string;
  slug: string;
  name: string;
  cuisine: string;
  description: string;
  tagline: string;
  imageUrl: string;
  logoUrl: string;
  menuUrl: string;
  qrImageUrl: string | null;
  priceRange: string;
  address: string;
  etaMinutes: number;
  pickupEtaMinutes: number;
  deliveryFee: string;
  minOrder: string;
  taxRate: string;
  isOpen: boolean;
  featured: boolean;
  acceptOnlineOrders: boolean;
  acceptDelivery: boolean;
  acceptPickup: boolean;
  lat: string | null;
  lng: string | null;
  deliveryRadiusKm: string;
};

function toPublicRestaurant(
  r: RawRestaurant,
  rating = 0,
  reviewCount = 0,
  extras: {
    vegetarian?: boolean;
    distanceKm?: number | null;
    deliversToYou?: boolean | null;
    offers?: PublicOffer[];
  } = {},
): PublicRestaurant {
  const lat = r.lat === null ? null : num(r.lat);
  const lng = r.lng === null ? null : num(r.lng);
  const deliveryRadiusKm = num(r.deliveryRadiusKm) || 8;
  return {
    id: r.id,
    marketplaceId: r.marketplaceId,
    slug: r.slug,
    name: r.name,
    cuisine: r.cuisine,
    cuisines: r.cuisine
      .split(/[,•/]/)
      .map((c) => c.trim())
      .filter(Boolean),
    description: r.description,
    tagline: r.tagline,
    imageUrl: r.imageUrl,
    logoUrl: r.logoUrl,
    menuUrl: r.menuUrl,
    ordersInternal: marketplaceOrderingEnabled,
    qrImageUrl: r.qrImageUrl ?? "",
    priceRange: r.priceRange,
    address: r.address,
    rating: Math.round(rating * 10) / 10,
    reviewCount,
    etaMinutes: r.etaMinutes,
    pickupEtaMinutes: r.pickupEtaMinutes,
    deliveryFee: num(r.deliveryFee),
    minOrder: num(r.minOrder),
    taxRate: num(r.taxRate),
    isOpen: r.isOpen,
    featured: r.featured,
    vegetarian: extras.vegetarian ?? false,
    lat,
    lng,
    deliveryRadiusKm,
    distanceKm: extras.distanceKm ?? null,
    deliversToYou: extras.deliversToYou ?? null,
    offers: extras.offers ?? [],
    accepts: {
      onlineOrders: r.acceptOnlineOrders,
      delivery: r.acceptDelivery,
      pickup: r.acceptPickup,
    },
  };
}

export async function listPublicRestaurants(opts: {
  search?: string;
  cuisine?: string;
  priceRange?: string;
  sort?: SortKey;
  minRating?: number;
  featuredOnly?: boolean;
  openOnly?: boolean;
  pickup?: boolean;
  delivery?: boolean;
  vegetarian?: boolean;
  lat?: number;
  lng?: number;
  limit?: number;
  offset?: number;
}): Promise<{ items: PublicRestaurant[]; total: number }> {
  const conditions = [listedCondition];
  if (opts.search) {
    conditions.push(
      or(
        ilike(restaurants.name, `%${opts.search}%`),
        ilike(restaurants.cuisine, `%${opts.search}%`),
        ilike(restaurants.description, `%${opts.search}%`),
        ilike(marketplaceProfiles.tagline, `%${opts.search}%`),
      )!,
    );
  }
  if (opts.cuisine && opts.cuisine !== "all") {
    conditions.push(eq(restaurants.cuisine, opts.cuisine));
  }
  if (opts.priceRange) {
    conditions.push(eq(restaurants.priceRange, opts.priceRange));
  }
  if (opts.featuredOnly) {
    conditions.push(eq(marketplaceProfiles.isFeatured, true));
  }
  if (opts.openOnly) {
    conditions.push(eq(restaurants.isOpen, true));
  }
  if (opts.pickup) {
    conditions.push(eq(marketplaceProfiles.acceptPickup, true));
  }
  if (opts.delivery) {
    conditions.push(eq(marketplaceProfiles.acceptDelivery, true));
  }
  if (opts.vegetarian) {
    conditions.push(
      sql`exists (select 1 from menu_items mi where mi.restaurant_id = ${restaurants.id} and mi.is_vegetarian)`,
    );
  }

  const where = and(...conditions);
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);

  // Open restaurants always float above closed ones, then the chosen sort.
  const openFirst = sql`${restaurants.isOpen} desc`;
  const avgRating = weightedRatingExpr;
  const reviewTally = publishedCountExpr;

  const ordering = (() => {
    switch (opts.sort) {
      case "rating":
        return [sql`${avgRating} desc`, sql`${reviewTally} desc`, asc(restaurants.name)];
      case "popular":
        return [sql`${reviewTally} desc`, sql`${avgRating} desc`, asc(restaurants.name)];
      // No geo data yet — delivery ETA is the honest proxy for proximity.
      case "nearby":
        return opts.lat != null && opts.lng != null
          ? [asc(restaurants.name)]
          : [asc(marketplaceProfiles.etaMinutes), asc(restaurants.name)];
      case "name":
        return [asc(restaurants.name)];
      default:
        return [
          desc(marketplaceProfiles.isFeatured),
          sql`${reviewTally} desc`,
          asc(restaurants.name),
        ];
    }
  })();

  const having = opts.minRating
    ? sql`${weightedRatingExpr} >= ${opts.minRating}`
    : undefined;

  const rows = await db
    .select({
      ...publicRestaurantColumns,
      rating: weightedRatingExpr,
      reviewCount: publishedCountExpr,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .leftJoin(reviews, eq(reviews.restaurantId, restaurants.id))
    .where(where)
    .groupBy(restaurants.id, marketplaceProfiles.id)
    .having(having)
    .orderBy(openFirst, ...ordering)
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(where);

  const origin =
    opts.lat != null && opts.lng != null
      ? { lat: opts.lat, lng: opts.lng }
      : null;
  let items = await decorateRestaurants(
    rows.map((r) => toPublicRestaurant(r, num(r.rating), num(r.reviewCount))),
    origin,
  );
  if (opts.sort === "nearby" && origin) {
    items = [...items].sort(
      (a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999),
    );
  }
  return { items, total: num(countRow?.total) };
}

/** Accepts a numeric id OR a slug so both `/1` and `/bella-napoli` work. */
async function resolveListed(idOrSlug: string): Promise<RawRestaurant | null> {
  const numeric = Number(idOrSlug);
  const match = Number.isInteger(numeric) && numeric > 0
    ? eq(restaurants.id, numeric)
    : eq(restaurants.slug, idOrSlug);

  const [r] = await db
    .select(publicRestaurantColumns)
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(and(match, listedCondition))
    .limit(1);

  return r ?? null;
}

export async function getPublicRestaurant(
  idOrSlug: string,
): Promise<PublicRestaurant | null> {
  const r = await resolveListed(idOrSlug);
  if (!r) return null;

  const [agg] = await db
    .select({
      rating: weightedRatingExpr,
      reviewCount: publishedCountExpr,
    })
    .from(reviews)
    .where(eq(reviews.restaurantId, r.id));

  return toPublicRestaurant(r, num(agg?.rating), num(agg?.reviewCount));
}

/**
 * PHASE 8 — POS Menu Integration
 *
 *   Restaurant (slug or id)
 *        ↓ resolveListed → restaurant.id (POS primary key)
 *        ↓
 *   Existing POS menu:
 *     - categories WHERE restaurant_id = ?
 *     - menu_items WHERE restaurant_id = ?
 *
 *   There is NO marketplace_menu, marketplace_menu_items, or any second
 *   menu database. The POS tables `categories` + `menu_items` remain the
 *   single source of truth. The marketplace only READS them.
 *
 *   Proof: search the codebase for `marketplace.*menu` — only the public
 *   projection `PublicMenu` exists, never a table.
 */
export async function getPublicMenu(idOrSlug: string): Promise<PublicMenu | null> {
  const r = await resolveListed(idOrSlug);
  if (!r) return null;

  // POS is source of truth — every query is keyed by restaurant_id.
  const [cats, items, agg] = await Promise.all([
    db
      .select({ id: categories.id, marketplaceId: categories.marketplaceId, name: categories.name })
      .from(categories)
      .where(eq(categories.restaurantId, r.id))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({
        id: menuItems.id,
        marketplaceId: menuItems.marketplaceId,
        externalId: menuItems.externalId,
        name: menuItems.name,
        description: menuItems.description,
        price: menuItems.price,
        imageUrl: menuItems.imageUrl,
        isAvailable: menuItems.isAvailable,
        isPopular: menuItems.isPopular,
        isVegetarian: menuItems.isVegetarian,
        categoryId: menuItems.categoryId,
      })
      .from(menuItems)
      .where(eq(menuItems.restaurantId, r.id))
      .orderBy(asc(menuItems.name)),
    db
      .select({
        rating: weightedRatingExpr,
        reviewCount: publishedCountExpr,
      })
      .from(reviews)
      .where(eq(reviews.restaurantId, r.id)),
  ]);

  // Modifier groups + modifiers for every menu_item in one round trip each.
  const itemIds = items.map((i) => i.id);
  const [modGroups, modOptions] = itemIds.length
    ? await Promise.all([
        db
          .select()
          .from(menuItemModifierGroups)
          .where(inArray(menuItemModifierGroups.menuItemId, itemIds))
          .orderBy(
            asc(menuItemModifierGroups.menuItemId),
            asc(menuItemModifierGroups.sortOrder),
            asc(menuItemModifierGroups.id),
          ),
        db
          .select()
          .from(menuItemModifiers)
          .orderBy(
            asc(menuItemModifiers.groupId),
            asc(menuItemModifiers.sortOrder),
            asc(menuItemModifiers.id),
          ),
      ])
    : [[], []];

  const groupsByItem = new Map<number, PublicModifierGroup[]>();
  const modsByGroup = new Map<number, PublicModifier[]>();
  for (const m of modOptions) {
    const list = modsByGroup.get(m.groupId) ?? [];
    list.push({
      id: m.id,
      name: m.name,
      priceDelta: num(m.priceDelta),
      available: m.isAvailable,
    });
    modsByGroup.set(m.groupId, list);
  }
  for (const g of modGroups) {
    const list = groupsByItem.get(g.menuItemId) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: modsByGroup.get(g.id) ?? [],
    });
    groupsByItem.set(g.menuItemId, list);
  }

  const categoryName = new Map(cats.map((c) => [c.id, c.name]));
  const categoryId = new Map(cats.map((c) => [c.id, c.marketplaceId]));
  const publicItems: PublicMenuItem[] = items.map((i) => ({
    id: i.id,
    menuItemId: i.marketplaceId,
    externalId: i.externalId ?? null,
    categoryId: i.categoryId ? (categoryId.get(i.categoryId) ?? null) : null,
    name: i.name,
    description: i.description,
    price: num(i.price),
    imageUrl: i.imageUrl,
    available: i.isAvailable,
    popular: i.isPopular,
    vegetarian: i.isVegetarian,
    category: i.categoryId ? (categoryName.get(i.categoryId) ?? "More") : "More",
    modifierGroups: groupsByItem.get(i.id) ?? [],
  }));

  const grouped = new Map<string, PublicMenuItem[]>();
  for (const item of publicItems) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  // PHASE 19 — resolve the restaurant's active menu stable id.
  const [activeMenu] = await db
    .select({ marketplaceId: menus.marketplaceId })
    .from(menus)
    .where(
      and(eq(menus.restaurantId, r.id), eq(menus.isDefault, true)),
    )
    .limit(1);
  const resolvedMenuId = activeMenu?.marketplaceId ?? "";

  return {
    restaurant: toPublicRestaurant(
      r,
      num(agg[0]?.rating),
      num(agg[0]?.reviewCount),
    ),
    menuId: resolvedMenuId,
    categories: [...grouped.entries()].map(([name, list]) => ({
      id: list[0]?.categoryId ?? "",
      name,
      items: list,
    })),
  };
}

export async function listPublicReviews(
  idOrSlug: string,
  limit = 20,
): Promise<{ restaurant: PublicRestaurant; reviews: PublicReview[] } | null> {
  const r = await resolveListed(idOrSlug);
  if (!r) return null;

  const [rows, agg] = await Promise.all([
    db
      .select({
        id: reviews.id,
        customerName: reviews.customerName,
        rating: reviews.rating,
        comment: reviews.comment,
        isVerified: reviews.isVerified,
        moderationStatus: reviews.moderationStatus,
        response: reviews.response,
        respondedAt: reviews.respondedAt,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(and(eq(reviews.restaurantId, r.id), publishedReviewFilter))
      .orderBy(desc(reviews.isVerified), desc(reviews.createdAt))
      .limit(Math.min(limit, 100)),
    db
      .select({
        rating: weightedRatingExpr,
        reviewCount: publishedCountExpr,
      })
      .from(reviews)
      .where(eq(reviews.restaurantId, r.id)),
  ]);

  return {
    restaurant: toPublicRestaurant(
      r,
      num(agg[0]?.rating),
      num(agg[0]?.reviewCount),
    ),
    reviews: rows.map((x) => ({
      id: x.id,
      author: x.customerName,
      rating: x.rating,
      comment: x.comment,
      verified: x.isVerified,
      createdAt: x.createdAt.toISOString(),
      response: x.response,
      respondedAt: x.respondedAt ? x.respondedAt.toISOString() : null,
    })),
  };
}

export type PublicPhotos = {
  restaurant: PublicRestaurant;
  photos: { url: string; caption: string; source: "cover" | "dish" }[];
};

export async function getPublicPhotos(
  idOrSlug: string,
): Promise<PublicPhotos | null> {
  const r = await resolveListed(idOrSlug);
  if (!r) return null;

  const [items, agg] = await Promise.all([
    db
      .select({ name: menuItems.name, imageUrl: menuItems.imageUrl })
      .from(menuItems)
      .where(eq(menuItems.restaurantId, r.id))
      .orderBy(desc(menuItems.isPopular), asc(menuItems.name)),
    db
      .select({
        rating: weightedRatingExpr,
        reviewCount: publishedCountExpr,
      })
      .from(reviews)
      .where(eq(reviews.restaurantId, r.id)),
  ]);

  const photos: PublicPhotos["photos"] = [
    { url: r.imageUrl, caption: r.name, source: "cover" },
    ...items
      .filter((i) => i.imageUrl)
      .map((i) => ({
        url: i.imageUrl,
        caption: i.name,
        source: "dish" as const,
      })),
  ];

  return {
    restaurant: toPublicRestaurant(
      r,
      num(agg[0]?.rating),
      num(agg[0]?.reviewCount),
    ),
    photos,
  };
}

export async function listCategories(): Promise<
  { cuisine: string; restaurantCount: number; priceRanges: string[] }[]
> {
  const rows = await db
    .select({
      cuisine: restaurants.cuisine,
      restaurantCount: sql<number>`count(*)`,
      priceRanges: sql<string[]>`array_agg(distinct ${restaurants.priceRange})`,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(listedCondition)
    .groupBy(restaurants.cuisine)
    .orderBy(asc(restaurants.cuisine));

  return rows.map((r) => ({
    cuisine: r.cuisine,
    restaurantCount: num(r.restaurantCount),
    priceRanges: (r.priceRanges ?? []).sort(),
  }));
}

export async function searchMarketplace(q: string) {
  const term = q.trim();
  if (!term) return { query: "", restaurants: [], dishes: [] };

  const like = `%${term}%`;
  const [restaurantRows, dishRows] = await Promise.all([
    db
      .select(publicRestaurantColumns)
      .from(restaurants)
      .innerJoin(
        marketplaceProfiles,
        eq(marketplaceProfiles.restaurantId, restaurants.id),
      )
      .where(
        and(
          listedCondition,
          or(
            ilike(restaurants.name, like),
            ilike(restaurants.cuisine, like),
            ilike(marketplaceProfiles.tagline, like),
          )!,
        ),
      )
      .orderBy(asc(restaurants.name))
      .limit(10),
    db
      .select({
        id: menuItems.id,
        name: menuItems.name,
        description: menuItems.description,
        price: menuItems.price,
        imageUrl: menuItems.imageUrl,
        isAvailable: menuItems.isAvailable,
        isPopular: menuItems.isPopular,
        restaurantSlug: restaurants.slug,
        restaurantName: restaurants.name,
        restaurantMenuUrl: marketplaceProfiles.menuUrl,
      })
      .from(menuItems)
      .innerJoin(
        restaurants,
        eq(restaurants.id, menuItems.restaurantId),
      )
      .innerJoin(
        marketplaceProfiles,
        eq(marketplaceProfiles.restaurantId, restaurants.id),
      )
      .where(
        and(
          listedCondition,
          or(
            ilike(menuItems.name, like),
            ilike(menuItems.description, like),
          )!,
        ),
      )
      .orderBy(desc(menuItems.isPopular), asc(menuItems.name))
      .limit(12),
  ]);

  const decorated = await decorateRestaurants(
    restaurantRows.map((r) => toPublicRestaurant(r)),
  );

  const cuisineHits = [
    ...new Set(
      decorated
        .flatMap((r) => r.cuisines)
        .filter((c) => c.toLowerCase().includes(term.toLowerCase())),
    ),
  ];

  return {
    query: term,
    restaurants: decorated,
    cuisines: cuisineHits,
    dishes: dishRows.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      price: num(d.price),
      imageUrl: d.imageUrl,
      available: d.isAvailable,
      popular: d.isPopular,
      restaurant: {
        slug: d.restaurantSlug,
        name: d.restaurantName,
        menuUrl: d.restaurantMenuUrl ?? "",
        orderingInternal: marketplaceOrderingEnabled,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Orders — single source of truth shared by every write path
// ---------------------------------------------------------------------------

export type IncomingLine = {
  menuItemId: number;
  quantity: number;
  modifierIds?: number[];
};

export type PlaceOrderInput = {
  restaurant: string; // id or slug
  customerId?: number | null;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  /**
   * PHASE 30 — dropoff coordinates captured at checkout, so the customer's
   * live rider track can render a real map. Optional (legacy orders are
   * text-address only); validated when provided for delivery orders.
   */
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  fulfillmentType?: "delivery" | "pickup";
  paymentMethod?: "cash" | "card";
  notes?: string;
  discountCode?: string | null;
  /** Simulates a card-gateway decline (fail-pre-check). Test-only in this build. */
  simulatePaymentFailure?: boolean;
  items: IncomingLine[];
  /**
   * PHASE 24 — optional pre-assigned order reference. Used by the Razorpay
   * flow so the order carries the same reference the customer was charged
   * against at payment-intent time. Validated to the MKT-xxxx pattern.
   */
  reference?: string;
  /**
   * PHASE 32 — scheduled delivery window (ISO). NULL/omitted = as soon as
   * possible. Validated at quote time to be 5+ minutes out and within 14 days.
   */
  scheduledFor?: string | null;
};

export type LookupDiscountResult =
  | { ok: true; discount: { code: string; kind: "percent" | "flat"; value: number; minSubtotal: number } }
  | { ok: false; error: string };

export async function lookupDiscount(
  idOrSlug: string,
  code: string,
): Promise<LookupDiscountResult> {
  const clean = code.trim().toUpperCase();
  if (!clean) return { ok: false, error: "Enter a code" };
  const numeric = Number(idOrSlug);
  const match =
    Number.isInteger(numeric) && numeric > 0
      ? eq(restaurants.id, numeric)
      : eq(restaurants.slug, idOrSlug);
  const [row] = await db
    .select({
      code: discounts.code,
      kind: discounts.kind,
      value: discounts.value,
      minSubtotal: discounts.minSubtotal,
      isActive: discounts.isActive,
    })
    .from(discounts)
    .innerJoin(restaurants, eq(restaurants.id, discounts.restaurantId))
    .where(and(match, eq(discounts.code, clean)))
    .limit(1);

  if (!row || !row.isActive) return { ok: false, error: "Invalid code" };
  return {
    ok: true,
    discount: {
      code: row.code,
      kind: row.kind === "flat" ? "flat" : "percent",
      value: num(row.value),
      minSubtotal: num(row.minSubtotal),
    },
  };
}

export type PlaceOrderResult =
  | { ok: true; id: number; reference: string; total: number; fulfillment: string }
  | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// PHASE 24 — marketplace pricing quote. Extracted from placeOrder so the
// payment-intent flow (Razorpay) can quote the exact amount it will charge
// WITHOUT creating any order row — order creation happens only after the
// payment is verified (see src/app/api/payments/verify). Both paths share one
// pricing authority.
// ---------------------------------------------------------------------------

type MarketplaceQuote = {
  restaurant: Pick<
    typeof restaurants.$inferSelect,
    "id" | "name" | "slug" | "isOpen" | "taxRate" | "lat" | "lng"
  >;
  profile: typeof marketplaceProfiles.$inferSelect;
  pricing: PricingResult;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  dropoff: LatLng | null;
  fulfillmentType: "delivery" | "pickup";
  paymentMethod: "cash" | "card";
  reference: string;
  scheduledFor: Date | null;
};

export type ComputeMarketplacePricingResult =
  | { ok: true; quote: MarketplaceQuote }
  | { ok: false; status: number; error: string };

export async function computeMarketplacePricing(
  input: PlaceOrderInput,
): Promise<ComputeMarketplacePricingResult> {
  const customerName = input.customerName.trim();
  const customerPhone = input.customerPhone.trim();
  const customerAddress = (input.customerAddress ?? "").trim();
  const fulfillmentType =
    input.fulfillmentType === "pickup" ? "pickup" : "delivery";
  const paymentMethod =
    input.paymentMethod === "card" ? "card" : ("cash" as const);

  if (!input.restaurant) return { ok: false, status: 400, error: "Restaurant is required" };
  if (!customerName || !customerPhone)
    return { ok: false, status: 400, error: "Name and phone are required" };
  if (fulfillmentType === "delivery" && !customerAddress)
    return { ok: false, status: 400, error: "Delivery address is required" };

  // PHASE 30 — optional dropoff fix for the live rider map. Only meaningful for
  // delivery; reject obviously-invalid pairs when the caller bothers to send
  // them so a bot can't poison the tracker with garbage coordinates.
  const dropoff = parseLatLng(
    input.dropoffLat == null ? null : String(input.dropoffLat),
    input.dropoffLng == null ? null : String(input.dropoffLng),
  );
  if (
    fulfillmentType === "delivery" &&
    (input.dropoffLat != null || input.dropoffLng != null) &&
    !dropoff
  ) {
    return {
      ok: false,
      status: 400,
      error: "Delivery coordinates are invalid",
    };
  }

  // PHASE 32 — scheduled delivery window. The checkout picker enforces a
  // 5-minute buffer and a 14-day horizon in the UI; the server revalidates so
  // a crafted request can't book an impossible window.
  let scheduledFor: Date | null = null;
  if (input.scheduledFor) {
    const parsed = new Date(input.scheduledFor);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, error: "Scheduled time is invalid" };
    }
    const now = Date.now();
    if (parsed.getTime() < now + 5 * 60_000) {
      return {
        ok: false,
        status: 400,
        error: "Scheduled time must be at least 5 minutes from now",
      };
    }
    if (parsed.getTime() > now + 14 * 24 * 60 * 60_000) {
      return {
        ok: false,
        status: 400,
        error: "Scheduled time can be at most 14 days from now",
      };
    }
    scheduledFor = parsed;
  }

  const clean: IncomingLine[] = (input.items ?? [])
    .map((i) => ({
      menuItemId: Number(i.menuItemId),
      quantity: Math.max(1, Math.floor(Number(i.quantity))),
      modifierIds: Array.isArray(i.modifierIds)
        ? i.modifierIds.map(Number).filter(Number.isInteger)
        : [],
    }))
    .filter((i) => Number.isInteger(i.menuItemId) && i.quantity > 0);

  if (clean.length === 0) return { ok: false, status: 400, error: "Your cart is empty" };

  // PHASE 24 — card pre-authorization. A real gateway declines here (402).
  // Fail before any DB write so a declined payment never creates a ticket.
  if (paymentMethod === "card" && input.simulatePaymentFailure) {
    return {
      ok: false,
      status: 402,
      error: "Payment was declined by the gateway. Please try a different card.",
    };
  }

  const numeric = Number(input.restaurant);
  const match =
    Number.isInteger(numeric) && numeric > 0
      ? eq(restaurants.id, numeric)
      : eq(restaurants.slug, input.restaurant);

  const [row] = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      isOpen: restaurants.isOpen,
      taxRate: restaurants.taxRate,
      lat: restaurants.lat,
      lng: restaurants.lng,
      profile: marketplaceProfiles,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(match)
    .limit(1);

  if (!row) return { ok: false, status: 404, error: "Restaurant not found" };
  const { profile, ...restaurant } = row;

  if (!profile.isListed || profile.marketplaceStatus !== "live")
    return { ok: false, status: 409, error: "This restaurant is not available on the marketplace" };
  if (!profile.acceptOnlineOrders)
    return { ok: false, status: 409, error: "This restaurant is not accepting online orders right now" };
  if (!restaurant.isOpen)
    return { ok: false, status: 409, error: "This restaurant is currently closed" };
  if (fulfillmentType === "delivery" && !profile.acceptDelivery)
    return { ok: false, status: 409, error: "This restaurant does not offer delivery" };
  if (fulfillmentType === "pickup" && !profile.acceptPickup)
    return { ok: false, status: 409, error: "This restaurant does not offer pickup" };

  // Load POS items + their modifier groups & modifiers.
  const itemIds = clean.map((i) => i.menuItemId);
  const [dbItems, dbGroups, dbMods] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(
        and(eq(menuItems.restaurantId, restaurant.id), inArray(menuItems.id, itemIds)),
      ),
    db
      .select()
      .from(menuItemModifierGroups)
      .where(inArray(menuItemModifierGroups.menuItemId, itemIds)),
    db.select().from(menuItemModifiers),
  ]);

  const groupsByItem = new Map<number, typeof dbGroups>();
  for (const g of dbGroups) {
    const list = groupsByItem.get(g.menuItemId) ?? [];
    list.push(g);
    groupsByItem.set(g.menuItemId, list);
  }
  const modsById = new Map(dbMods.map((m) => [m.id, m]));

  const priceLines: LineInput[] = [];
  for (const ci of clean) {
    const item = dbItems.find((d) => d.id === ci.menuItemId);
    if (!item || !item.isAvailable) continue;

    const itemGroups = groupsByItem.get(item.id) ?? [];
    const chosen = (ci.modifierIds ?? [])
      .map((id) => modsById.get(id))
      .filter((m): m is NonNullable<typeof m> => !!m && m.isAvailable);

    // Validate min/max per group.
    const countByGroup = new Map<number, number>();
    for (const m of chosen) {
      countByGroup.set(m.groupId, (countByGroup.get(m.groupId) ?? 0) + 1);
    }
    for (const g of itemGroups) {
      const n = countByGroup.get(g.id) ?? 0;
      if (n < g.minSelect) {
        return {
          ok: false,
          status: 400,
          error: `Please choose at least ${g.minSelect} option${g.minSelect === 1 ? "" : "s"} in "${g.name}" for ${item.name}.`,
        };
      }
      if (n > g.maxSelect) {
        return {
          ok: false,
          status: 400,
          error: `Choose at most ${g.maxSelect} option${g.maxSelect === 1 ? "" : "s"} in "${g.name}" for ${item.name}.`,
        };
      }
    }

    // Ignore modifiers that don't belong to this item.
    const groupIds = new Set(itemGroups.map((g) => g.id));
    const validChosen: LineModifierSelection[] = chosen
      .filter((m) => groupIds.has(m.groupId))
      .map((m) => {
        const g = itemGroups.find((x) => x.id === m.groupId)!;
        return {
          groupId: g.id,
          groupName: g.name,
          modifierId: m.id,
          modifierName: m.name,
          priceDelta: num(m.priceDelta),
        };
      });

    priceLines.push({
      menuItemId: item.id,
      name: item.name,
      basePrice: num(item.price),
      quantity: ci.quantity,
      modifiers: validChosen,
    });
  }

  if (priceLines.length === 0)
    return { ok: false, status: 400, error: "None of the selected items are available" };

  // Discount lookup — POS-owned.
  let discount:
    | { code: string; kind: "percent" | "flat"; value: number; minSubtotal: number }
    | null = null;
  if (input.discountCode) {
    const look = await lookupDiscount(String(restaurant.id), input.discountCode);
    if (!look.ok) return { ok: false, status: 400, error: look.error };
    discount = look.discount;
  }

  const pricing = priceCart({
    lines: priceLines,
    taxRate: num(restaurant.taxRate),
    deliveryFee: num(profile.deliveryFee),
    fulfillment: fulfillmentType,
    discount,
  });

  if (pricing.discountError) return { ok: false, status: 400, error: pricing.discountError };

  const minOrder = num(profile.minOrder);
  if (pricing.subtotal < minOrder) {
    return {
      ok: false,
      status: 400,
      error: `Minimum order is ${currency(minOrder)}. Add ${currency(minOrder - pricing.subtotal)} more.`,
    };
  }

  // PHASE 24 — an optional pre-assigned reference lets the Razorpay flow keep
  // the same reference the customer was charged against.
  let reference: string;
  if (input.reference) {
    const cleanRef = input.reference.trim().toUpperCase();
    if (!/^MKT-[A-Z0-9]+$/.test(cleanRef)) {
      return { ok: false, status: 400, error: "Invalid order reference" };
    }
    reference = cleanRef;
  } else {
    reference = orderReference();
  }

  return {
    ok: true,
    quote: {
      restaurant,
      profile,
      pricing,
      customerName,
      customerPhone,
      customerAddress,
      dropoff: fulfillmentType === "delivery" ? dropoff : null,
      fulfillmentType,
      paymentMethod,
      reference,
      scheduledFor,
    },
  };
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const priced = await computeMarketplacePricing(input);
  if (!priced.ok) return { ok: false, status: priced.status, error: priced.error };

  const {
    restaurant,
    pricing,
    customerName,
    customerPhone,
    customerAddress,
    dropoff,
    fulfillmentType,
    paymentMethod,
    reference,
    scheduledFor,
  } = priced.quote;

  const created = await db.transaction(async (tx) => {
    let customerId: number;
    if (input.customerId) {
      customerId = input.customerId;
      // Keep the customer name/phone fresh in the POS directory.
      await tx
        .update(customers)
        .set({ name: customerName, phone: customerPhone })
        .where(eq(customers.id, customerId));
    } else {
      const [existing] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.phone, customerPhone))
        .limit(1);
      if (existing) {
        customerId = existing.id;
      } else {
        const [ins] = await tx
          .insert(customers)
          .values({ name: customerName, phone: customerPhone })
          .returning({ id: customers.id });
        customerId = ins.id;
      }
    }

    const [order] = await tx
      .insert(orders)
      .values({
        reference,
        restaurantId: restaurant.id,
        customerId,
        customerName,
        customerPhone,
        customerAddress: fulfillmentType === "pickup" ? "" : customerAddress,
        dropoffLat:
          fulfillmentType === "delivery" && dropoff
            ? dropoff.lat.toFixed(6)
            : null,
        dropoffLng:
          fulfillmentType === "delivery" && dropoff
            ? dropoff.lng.toFixed(6)
            : null,
        channel: "marketplace",
        fulfillmentType,
        status: "placed",
        paymentMethod,
        paymentStatus: paymentMethod === "card" ? "paid" : "unpaid",
        subtotal: pricing.subtotal.toFixed(2),
        taxAmount: pricing.taxAmount.toFixed(2),
        discountCode: pricing.discountCode,
        discountAmount: pricing.discountAmount.toFixed(2),
        deliveryFee: pricing.deliveryFee.toFixed(2),
        total: pricing.total.toFixed(2),
        notes: (input.notes ?? "").trim(),
        scheduledFor: scheduledFor ?? null,
      })
      .returning();

    await tx.insert(orderStatusEvents).values({
      orderId: order.id,
      fromStatus: null,
      toStatus: "placed",
      actor: "system",
      note: "Order placed from marketplace",
    });

    // PHASE 10 — audit trail: placed, then the payment + restaurant handoff
    // milestones. Card is captured up-front for the marketplace checkout, so
    // PAYMENT_CONFIRMED is recorded at placement alongside the order.
    await appendOrderEvent(tx, {
      orderId: order.id,
      type: "ORDER_PLACED",
      actor: "system",
      toStatus: "placed",
      meta: {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        fulfillment: fulfillmentType,
        paymentMethod,
        subtotal: pricing.subtotal,
        tax: pricing.taxAmount,
        discount: pricing.discountAmount,
        deliveryFee: pricing.deliveryFee,
        total: pricing.total,
      },
      note: "Order placed from marketplace",
    });
    if (paymentMethod === "card") {
      await appendOrderEvent(tx, {
        orderId: order.id,
        type: "PAYMENT_CONFIRMED",
        actor: "payment",
        meta: { method: "card", amount: pricing.total, status: "paid" },
        note: "Card payment captured up-front",
      });
    }
    await appendOrderEvent(tx, {
      orderId: order.id,
      type: "ORDER_SENT_TO_RESTAURANT",
      actor: "system",
      meta: { restaurantId: restaurant.id },
      note: "Visible in the restaurant POS queue",
    });

    await tx.insert(orderItems).values(
      pricing.lines.map((l) => ({
        orderId: order.id,
        menuItemId: l.menuItemId,
        name: l.name,
        unitPrice: l.unitPrice.toFixed(2),
        quantity: l.quantity,
        modifiers: JSON.stringify(l.modifiers),
      })),
    );

    // PHASE 21 — enqueue order-placed notification inside the same transaction.
    await tx.insert(notifications).values({
      customerId,
      phone: customerPhone,
      orderId: order.id,
      kind: "order_placed",
      message: `${restaurant.name} was sent your order ${reference}.`,
      channel: "push",
    });

    // PHASE 32 — a scheduled (future-window) order surfaces its window as a
    // dedicated notification so the customer knows it is booked, not live.
    if (scheduledFor) {
      await tx.insert(notifications).values({
        customerId,
        phone: customerPhone,
        orderId: order.id,
        kind: "order_scheduled",
        message: `Your order ${reference} is scheduled for ${shortDateTime(scheduledFor)}.`,
        channel: "push",
      });
    }

    // PHASE 21 — card payment sets a payment-successful notification too.
    if (paymentMethod === "card") {
      await tx.insert(notifications).values({
        customerId,
        phone: customerPhone,
        orderId: order.id,
        kind: "payment_successful",
        message: `Payment of ${currency(pricing.total)} for order ${reference} was successful.`,
        channel: "push",
      });
    }

    // PHASE 45 — a delivery order gets its delivery track at placement
    // (status `pending`), so the customer tracker shows "Waiting for a
    // driver" even before any rider is assigned. Idempotent on order_id;
    // assigning a partner later just advances this same track.
    if (fulfillmentType === "delivery") {
      await createDeliveryOrderForOrderTx(tx, {
        orderId: order.id,
        restaurantId: restaurant.id,
        deliveryFee: pricing.deliveryFee.toFixed(2),
        dropoffLat: dropoff ? dropoff.lat.toFixed(6) : null,
        dropoffLng: dropoff ? dropoff.lng.toFixed(6) : null,
        scheduledFor: scheduledFor ?? null,
        pickup: { lat: restaurant.lat, lng: restaurant.lng },
        mode: "platform",
      });
    }

    return order;
  });

  // PHASE 24 — deliver the order-placed/payment push right after commit so the
  // customer sees it without waiting for the sweep cron.
  void flushOrder(created.id).catch((e) => {
    console.error("push flush failed for order", created.id, e);
  });

  // PHASE 28 — real-time: notify any open trackers of the new order.
  void publishOrderEvent(created.reference, "placed", "system");

  // PHASE 36 — outbound delivery to a connected RestaurantAI/POS endpoint
  // (order.created). Enqueue never sends; a worker dispatch delivers it.
  void enqueueOutboundEvent(created.id, "order.created").catch((e) => {
    console.error("outbox enqueue failed for order", created.id, e);
  });

  return {
    ok: true,
    id: created.id,
    reference: created.reference,
    total: pricing.total,
    fulfillment: fulfillmentType,
  };
}

export async function listSavedRestaurantsForCustomer(
  customerId: number,
): Promise<PublicRestaurant[]> {
  const rows = await db
    .select(publicRestaurantColumns)
    .from(savedRestaurants)
    .innerJoin(restaurants, eq(restaurants.id, savedRestaurants.restaurantId))
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(and(eq(savedRestaurants.customerId, customerId), listedCondition))
    .orderBy(desc(savedRestaurants.createdAt));
  return decorateRestaurants(rows.map((r) => toPublicRestaurant(r)));
}

export async function getPublicOrder(
  idOrReference: string,
): Promise<PublicOrder | null> {
  // PHASE 27 — references only. Numeric id lookup removed: sequential order
  // ids made every order enumerable in one scan. On public-facing endpoints
  // the reference is the (high-entropy) access credential, so ids must never
  // be an alternative route in.
  const match = eq(orders.reference, idOrReference.toUpperCase());

  const [row] = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      channel: orders.channel,
      fulfillmentType: orders.fulfillmentType,
      paymentMethod: orders.paymentMethod,
      paymentStatus: orders.paymentStatus,
      customerName: orders.customerName,
      customerAddress: orders.customerAddress,
      subtotal: orders.subtotal,
      taxAmount: orders.taxAmount,
      discountCode: orders.discountCode,
      discountAmount: orders.discountAmount,
      deliveryFee: orders.deliveryFee,
      total: orders.total,
      scheduledFor: orders.scheduledFor,
      createdAt: orders.createdAt,
      restaurantId: restaurants.id,
      restaurantMarketplaceId: restaurants.marketplaceId,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
      restaurantLat: restaurants.lat,
      restaurantLng: restaurants.lng,
    })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .where(match)
    .limit(1);

  if (!row) return null;

  const [items, events, audit, existingReview, delivery] = await Promise.all([
    db
      .select({
        name: orderItems.name,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        modifiers: orderItems.modifiers,
        menuItemId: orderItems.menuItemId,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id)),
    db
      .select()
      .from(orderStatusEvents)
      .where(eq(orderStatusEvents.orderId, row.id))
      .orderBy(asc(orderStatusEvents.createdAt)),
    listOrderEvents(row.id),
    db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.orderId, row.id))
      .limit(1),
    getDeliveryForOrder(row.id),
  ]);

  const lifecycle = summarizeStatus(row.status);
  const timeline = (
    events.length
      ? events
      : [{ toStatus: "placed", actor: "system", createdAt: row.createdAt }]
  ).map((e) => ({
    status: e.toStatus,
    label: statusLabel(e.toStatus),
    at: e.createdAt.toISOString(),
    actor: e.actor,
  }));

  const delivered = lifecycle.status === "delivered";
  const alreadyReviewed = existingReview.length > 0;
  let reviewEligible = delivered && !alreadyReviewed;
  let reviewReason: string | null = null;
  if (alreadyReviewed) reviewReason = "You already reviewed this order.";
  else if (!delivered) reviewReason = "Review after your order is delivered.";

  return {
    id: row.id,
    reference: row.reference,
    status: lifecycle.status,
    rawStatus: row.status,
    source: row.channel,
    fulfillment: row.fulfillmentType === "pickup" ? "pickup" : "delivery",
    payment: { method: row.paymentMethod, status: row.paymentStatus },
    customer: { name: row.customerName, address: row.customerAddress },
    restaurant: {
      id: row.restaurantId,
      marketplaceId: row.restaurantMarketplaceId,
      name: row.restaurantName,
      slug: row.restaurantSlug,
      lat: row.restaurantLat == null ? null : num(row.restaurantLat),
      lng: row.restaurantLng == null ? null : num(row.restaurantLng),
    },
    totals: {
      subtotal: num(row.subtotal),
      discount: num(row.discountAmount),
      discountCode: row.discountCode ?? null,
      tax: num(row.taxAmount),
      deliveryFee: num(row.deliveryFee),
      total: num(row.total),
    },
    items: items.map((i) => {
      let mods: LineModifierSelection[] = [];
      try {
        mods = JSON.parse(i.modifiers) as LineModifierSelection[];
      } catch {
        /* ignore */
      }
      return {
        name: i.name,
        quantity: i.quantity,
        unitPrice: num(i.unitPrice),
        modifiers: mods,
        itemId: i.menuItemId,
      };
    }),
    lifecycle: {
      status: lifecycle.status,
      label: lifecycle.label,
      step: lifecycle.step,
      terminal: lifecycle.terminal,
      next: lifecycle.next,
    },
    timeline,
    events: toPublicEventViews(
      audit.length
        ? audit
        : [
            {
              type: "ORDER_PLACED",
              label: "Order placed",
              actor: "system",
              from: null,
              to: "placed",
              meta: {},
              note: "",
              at: row.createdAt.toISOString(),
            },
          ],
    ),
    delivery,
    review: {
      eligible: reviewEligible,
      reason: reviewReason,
      alreadyReviewed,
    },
    placedAt: row.createdAt.toISOString(),
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
  };
}

export type SubmitReviewInput = {
  restaurant: string;
  author: string;
  rating: number;
  comment?: string;
  orderReference?: string;
  customerId?: number | null;
};

export type SubmitReviewResult =
  | { ok: true; review: PublicReview }
  | { ok: false; status: number; error: string };

export async function submitReview(
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  const author = input.author.trim();
  const rating = Math.round(Number(input.rating));
  const comment = (input.comment ?? "").trim();
  const orderRef = (input.orderReference ?? "").trim().toUpperCase();

  if (!author) return { ok: false, status: 400, error: "Name is required" };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, status: 400, error: "Rating must be between 1 and 5" };
  }

  const numeric = Number(input.restaurant);
  const match =
    Number.isInteger(numeric) && numeric > 0
      ? eq(restaurants.id, numeric)
      : eq(restaurants.slug, input.restaurant);

  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(match)
    .limit(1);

  if (!restaurant) {
    return { ok: false, status: 404, error: "Restaurant not found" };
  }

  if (!orderRef) {
    return {
      ok: false,
      status: 400,
      error: "Review only eligible on a delivered order",
    };
  }

  const [order] = await db
    .select({
      id: orders.id,
      customerId: orders.customerId,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.reference, orderRef),
        eq(orders.restaurantId, restaurant.id),
      ),
    )
    .limit(1);

  if (!order) {
    return {
      ok: false,
      status: 400,
      error: "That order reference does not match this restaurant",
    };
  }

  if (summarizeStatus(order.status).status !== "delivered") {
    return {
      ok: false,
      status: 409,
      error: "You can review once the order is delivered.",
    };
  }

  if (input.customerId && order.customerId && order.customerId !== input.customerId) {
    return {
      ok: false,
      status: 403,
      error: "You can only review your own orders.",
    };
  }

  const [dupe] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.orderId, order.id))
    .limit(1);
  if (dupe) {
    return {
      ok: false,
      status: 409,
      error: "This order has already been reviewed",
    };
  }

  const [created] = await db
    .insert(reviews)
    .values({
      restaurantId: restaurant.id,
      customerId: order.customerId,
      orderId: order.id,
      customerName: author,
      rating,
      comment,
      isVerified: true,
    })
    .returning();

  return {
    ok: true,
    review: {
      id: created.id,
      author: created.customerName,
      rating: created.rating,
      comment: created.comment,
      verified: created.isVerified,
      createdAt: created.createdAt.toISOString(),
      response: "",
      respondedAt: null,
    },
  };
}

/** Attach vegetarian flags, public offers, and optional distance. */
async function decorateRestaurants(
  items: PublicRestaurant[],
  origin?: { lat: number; lng: number } | null,
): Promise<PublicRestaurant[]> {
  if (items.length === 0) return items;
  const ids = items.map((i) => i.id);

  const [vegRows, offerRows] = await Promise.all([
    db
      .select({
        restaurantId: menuItems.restaurantId,
        n: sql<number>`count(*) filter (where ${menuItems.isVegetarian})`,
      })
      .from(menuItems)
      .where(inArray(menuItems.restaurantId, ids))
      .groupBy(menuItems.restaurantId),
    db
      .select({
        restaurantId: discounts.restaurantId,
        code: discounts.code,
        title: discounts.title,
        kind: discounts.kind,
        value: discounts.value,
        minSubtotal: discounts.minSubtotal,
        freeMenuItemId: discounts.freeMenuItemId,
      })
      .from(discounts)
      .where(and(eq(discounts.isActive, true), eq(discounts.isPublic, true), inArray(discounts.restaurantId, ids))),
  ]);

  const veg = new Set(
    vegRows.filter((v) => Number(v.n) > 0).map((v) => v.restaurantId),
  );
  const offersBy = new Map<number, PublicOffer[]>();
  const freeIds = offerRows
    .map((o) => o.freeMenuItemId)
    .filter((id): id is number => typeof id === "number" && id > 0);
  const freeNames = new Map<number, string>();
  if (freeIds.length) {
    const names = await db
      .select({ id: menuItems.id, name: menuItems.name })
      .from(menuItems)
      .where(inArray(menuItems.id, freeIds));
    for (const n of names) freeNames.set(n.id, n.name);
  }
  for (const o of offerRows) {
    const list = offersBy.get(o.restaurantId) ?? [];
    list.push({
      code: o.code,
      title: o.title || o.code,
      kind:
        o.kind === "flat"
          ? "flat"
          : o.kind === "free_item"
            ? "free_item"
            : "percent",
      value: num(o.value),
      minSubtotal: num(o.minSubtotal),
      freeItemName: o.freeMenuItemId
        ? (freeNames.get(o.freeMenuItemId) ?? null)
        : null,
    });
    offersBy.set(o.restaurantId, list);
  }

  return items.map((r) => {
    const distanceKm =
      origin && r.lat !== null && r.lng !== null
        ? Math.round(haversineKm(origin, { lat: r.lat, lng: r.lng }) * 10) / 10
        : null;
    const deliversToYou =
      distanceKm === null
        ? null
        : r.accepts.delivery && distanceKm <= r.deliveryRadiusKm;
    return {
      ...r,
      vegetarian: veg.has(r.id),
      offers: offersBy.get(r.id) ?? [],
      distanceKm,
      deliversToYou,
    };
  });
}
