import { db } from "@/db";
import {
  restaurants,
  marketplaceProfiles,
  restaurantIntegrations,
  categories,
  menuItems,
  reviews,
  orders,
  orderItems,
  webhookEvents,
} from "@/db/schema";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { num } from "./format";

// `description` / `imageUrl` live on the POS restaurant record. The marketplace
// profile may override them; null means "inherit". Resolved here in SQL so no
// data is duplicated at rest.
const resolvedDescription = sql<string>`coalesce(nullif(${marketplaceProfiles.descriptionOverride}, ''), ${restaurants.description})`;
const resolvedCover = sql<string>`coalesce(nullif(${marketplaceProfiles.coverImageOverride}, ''), ${restaurants.imageUrl})`;

/** A restaurant is visible on the storefront only when its profile says so. */
const listedCondition = and(
  eq(marketplaceProfiles.isListed, true),
  eq(marketplaceProfiles.marketplaceStatus, "live"),
);

export type RestaurantSummary = {
  id: number;
  name: string;
  slug: string;
  cuisine: string;
  description: string;
  imageUrl: string;
  logoUrl: string;
  tagline: string;
  priceRange: string;
  deliveryFee: number;
  minOrder: number;
  etaMinutes: number;
  pickupEtaMinutes: number;
  isOpen: boolean;
  featured: boolean;
  acceptOnlineOrders: boolean;
  acceptDelivery: boolean;
  acceptPickup: boolean;
  rating: number;
  reviewCount: number;
};

export async function getRestaurants(
  opts: { search?: string; cuisine?: string } = {},
): Promise<RestaurantSummary[]> {
  const conditions = [listedCondition];
  if (opts.search) {
    conditions.push(
      or(
        ilike(restaurants.name, `%${opts.search}%`),
        ilike(restaurants.cuisine, `%${opts.search}%`),
        ilike(restaurants.description, `%${opts.search}%`),
      )!,
    );
  }
  if (opts.cuisine && opts.cuisine !== "all") {
    conditions.push(eq(restaurants.cuisine, opts.cuisine));
  }

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      cuisine: restaurants.cuisine,
      description: resolvedDescription,
      imageUrl: resolvedCover,
      logoUrl: marketplaceProfiles.logoUrl,
      tagline: marketplaceProfiles.tagline,
      priceRange: restaurants.priceRange,
      deliveryFee: marketplaceProfiles.deliveryFee,
      minOrder: marketplaceProfiles.minOrder,
      etaMinutes: marketplaceProfiles.etaMinutes,
      pickupEtaMinutes: marketplaceProfiles.pickupEtaMinutes,
      isOpen: restaurants.isOpen,
      featured: marketplaceProfiles.isFeatured,
      acceptOnlineOrders: marketplaceProfiles.acceptOnlineOrders,
      acceptDelivery: marketplaceProfiles.acceptDelivery,
      acceptPickup: marketplaceProfiles.acceptPickup,
      rating: sql<number>`coalesce(avg(${reviews.rating}), 0)`,
      reviewCount: sql<number>`count(${reviews.id})`,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .leftJoin(reviews, eq(reviews.restaurantId, restaurants.id))
    .where(and(...conditions))
    .groupBy(restaurants.id, marketplaceProfiles.id)
    .orderBy(desc(marketplaceProfiles.isFeatured), asc(restaurants.name));

  return rows.map((r) => ({
    ...r,
    deliveryFee: num(r.deliveryFee),
    minOrder: num(r.minOrder),
    rating: Math.round(num(r.rating) * 10) / 10,
    reviewCount: num(r.reviewCount),
  }));
}

export async function getCuisines(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ cuisine: restaurants.cuisine })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(listedCondition)
    .orderBy(asc(restaurants.cuisine));
  return rows.map((r) => r.cuisine);
}

export type MenuItemView = {
  id: number;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isAvailable: boolean;
  isPopular: boolean;
  categoryId: number | null;
};

export type MenuGroup = {
  categoryId: number | null;
  categoryName: string;
  items: MenuItemView[];
};

export type ReviewView = {
  id: number;
  customerName: string;
  rating: number;
  comment: string;
  isVerified: boolean;
  createdAt: string;
};

export type RestaurantDetail = RestaurantSummary & {
  address: string;
  menu: MenuGroup[];
  reviews: ReviewView[];
};

export async function getRestaurantBySlug(
  slug: string,
): Promise<RestaurantDetail | null> {
  const [r] = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      cuisine: restaurants.cuisine,
      description: resolvedDescription,
      imageUrl: resolvedCover,
      logoUrl: marketplaceProfiles.logoUrl,
      tagline: marketplaceProfiles.tagline,
      priceRange: restaurants.priceRange,
      address: restaurants.address,
      deliveryFee: marketplaceProfiles.deliveryFee,
      minOrder: marketplaceProfiles.minOrder,
      etaMinutes: marketplaceProfiles.etaMinutes,
      pickupEtaMinutes: marketplaceProfiles.pickupEtaMinutes,
      isOpen: restaurants.isOpen,
      featured: marketplaceProfiles.isFeatured,
      acceptOnlineOrders: marketplaceProfiles.acceptOnlineOrders,
      acceptDelivery: marketplaceProfiles.acceptDelivery,
      acceptPickup: marketplaceProfiles.acceptPickup,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .where(and(eq(restaurants.slug, slug), listedCondition))
    .limit(1);

  if (!r) return null;

  const [cats, items, revs] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.restaurantId, r.id))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select()
      .from(menuItems)
      .where(eq(menuItems.restaurantId, r.id))
      .orderBy(asc(menuItems.name)),
    db
      .select()
      .from(reviews)
      .where(eq(reviews.restaurantId, r.id))
      .orderBy(desc(reviews.isVerified), desc(reviews.createdAt))
      .limit(50),
  ]);

  const itemViews: MenuItemView[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    price: num(i.price),
    imageUrl: i.imageUrl,
    isAvailable: i.isAvailable,
    isPopular: i.isPopular,
    categoryId: i.categoryId,
  }));

  const groups: MenuGroup[] = cats.map((c) => ({
    categoryId: c.id,
    categoryName: c.name,
    items: itemViews.filter((i) => i.categoryId === c.id),
  }));

  const uncategorized = itemViews.filter(
    (i) => i.categoryId === null || !cats.some((c) => c.id === i.categoryId),
  );
  if (uncategorized.length) {
    groups.push({ categoryId: null, categoryName: "More", items: uncategorized });
  }

  const rating =
    revs.length > 0
      ? Math.round((revs.reduce((s, x) => s + x.rating, 0) / revs.length) * 10) / 10
      : 0;

  return {
    ...r,
    deliveryFee: num(r.deliveryFee),
    minOrder: num(r.minOrder),
    rating,
    reviewCount: revs.length,
    menu: groups.filter((g) => g.items.length > 0),
    reviews: revs.map((x) => ({
      id: x.id,
      customerName: x.customerName,
      rating: x.rating,
      comment: x.comment,
      isVerified: x.isVerified,
      createdAt: x.createdAt.toISOString(),
    })),
  };
}

export type OrderView = {
  id: number;
  reference: string;
  restaurantName: string;
  restaurantSlug: string;
  status: string;
  fulfillmentType: string;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  customerAddress: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  posDeliveryStatus: string;
  posDeliveryAttempts: number;
  posLastDeliveryError: string;
  createdAt: string;
  items: { name: string; quantity: number; unitPrice: number }[];
};

const orderColumns = {
  id: orders.id,
  reference: orders.reference,
  restaurantName: restaurants.name,
  restaurantSlug: restaurants.slug,
  status: orders.status,
  fulfillmentType: orders.fulfillmentType,
  paymentMethod: orders.paymentMethod,
  paymentStatus: orders.paymentStatus,
  customerName: orders.customerName,
  customerAddress: orders.customerAddress,
  subtotal: orders.subtotal,
  deliveryFee: orders.deliveryFee,
  total: orders.total,
  posDeliveryStatus: orders.posDeliveryStatus,
  posDeliveryAttempts: orders.posDeliveryAttempts,
  posLastDeliveryError: orders.posLastDeliveryError,
  createdAt: orders.createdAt,
};

export async function getOrderByReference(
  reference: string,
): Promise<OrderView | null> {
  const [row] = await db
    .select(orderColumns)
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .where(eq(orders.reference, reference))
    .limit(1);

  if (!row) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, row.id));

  return {
    ...row,
    subtotal: num(row.subtotal),
    deliveryFee: num(row.deliveryFee),
    total: num(row.total),
    createdAt: row.createdAt.toISOString(),
    items: items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: num(i.unitPrice),
    })),
  };
}

export async function getRecentOrders(limit = 12): Promise<OrderView[]> {
  const rows = await db
    .select(orderColumns)
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    subtotal: num(row.subtotal),
    deliveryFee: num(row.deliveryFee),
    total: num(row.total),
    createdAt: row.createdAt.toISOString(),
    items: [],
  }));
}

// ---------------------------------------------------------------------------
// Marketplace listing administration (Phase 2 testable surface)
// ---------------------------------------------------------------------------

export type ListingRow = {
  restaurantId: number;
  profileId: number;
  name: string;
  slug: string;
  cuisine: string;
  description: string;
  address: string;
  imageUrl: string;
  menuUrl: string;
  qrImageUrl: string | null;
  isListed: boolean;
  marketplaceStatus: string;
  isFeatured: boolean;
  acceptOnlineOrders: boolean;
  acceptDelivery: boolean;
  acceptPickup: boolean;
  deliveryFee: number;
  minOrder: number;
  etaMinutes: number;
  commissionRate: number;
  hasOverride: boolean;
};

/** Includes UNLISTED restaurants — POS data stays intact even when hidden. */
export async function getAllListings(): Promise<ListingRow[]> {
  const rows = await db
    .select({
      restaurantId: restaurants.id,
      profileId: marketplaceProfiles.id,
      name: restaurants.name,
      slug: restaurants.slug,
      cuisine: restaurants.cuisine,
      description: restaurants.description,
      address: restaurants.address,
      imageUrl: restaurants.imageUrl,
      isListed: marketplaceProfiles.isListed,
      marketplaceStatus: marketplaceProfiles.marketplaceStatus,
      isFeatured: marketplaceProfiles.isFeatured,
      acceptOnlineOrders: marketplaceProfiles.acceptOnlineOrders,
      acceptDelivery: marketplaceProfiles.acceptDelivery,
      acceptPickup: marketplaceProfiles.acceptPickup,
      deliveryFee: marketplaceProfiles.deliveryFee,
      minOrder: marketplaceProfiles.minOrder,
      etaMinutes: marketplaceProfiles.etaMinutes,
      commissionRate: marketplaceProfiles.commissionRate,
      menuUrl: marketplaceProfiles.menuUrl,
      qrImageUrl: marketplaceProfiles.qrImageUrl,
      hasOverride: sql<boolean>`(${marketplaceProfiles.descriptionOverride} is not null or ${marketplaceProfiles.coverImageOverride} is not null)`,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .orderBy(asc(restaurants.name));

  return rows.map((r) => ({
    ...r,
    deliveryFee: num(r.deliveryFee),
    minOrder: num(r.minOrder),
    commissionRate: num(r.commissionRate),
  }));
}

// ---------------------------------------------------------------------------
// Phase 3 — Admin restaurant management
// ---------------------------------------------------------------------------

export type AdminRestaurantRow = {
  id: number;
  name: string;
  slug: string;
  marketplaceId: string;
  cuisine: string;
  address: string;
  phone: string;
  openingHours: string;
  imageUrl: string;
  logoUrl: string;
  deliveryRadiusKm: number;
  isOpen: boolean;
  isListed: boolean;
  marketplaceStatus: string;
  integrationProvider: string;
  integrationStatus: string;
  createdAt: Date;
};

/** All restaurants for the admin management page, with integration status. */
export async function getAllRestaurants(): Promise<AdminRestaurantRow[]> {
  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      marketplaceId: restaurants.marketplaceId,
      cuisine: restaurants.cuisine,
      address: restaurants.address,
      phone: restaurants.phone,
      openingHours: restaurants.openingHours,
      imageUrl: restaurants.imageUrl,
      logoUrl: marketplaceProfiles.logoUrl,
      deliveryRadiusKm: restaurants.deliveryRadiusKm,
      isOpen: restaurants.isOpen,
      isListed: marketplaceProfiles.isListed,
      marketplaceStatus: marketplaceProfiles.marketplaceStatus,
      integrationProvider: restaurantIntegrations.provider,
      integrationStatus: restaurantIntegrations.status,
      createdAt: restaurants.createdAt,
    })
    .from(restaurants)
    .innerJoin(
      marketplaceProfiles,
      eq(marketplaceProfiles.restaurantId, restaurants.id),
    )
    .leftJoin(
      restaurantIntegrations,
      eq(restaurantIntegrations.restaurantId, restaurants.id),
    )
    .orderBy(asc(restaurants.name));

  return rows.map((r) => ({
    ...r,
    deliveryRadiusKm: num(r.deliveryRadiusKm),
    integrationProvider: r.integrationProvider ?? "manual",
    integrationStatus: r.integrationStatus ?? "disconnected",
  }));
}

// ---------------------------------------------------------------------------
// PHASE 16 — POS delivery status (failure handling)
// ---------------------------------------------------------------------------

export type OrderDeliveryView = {
  orderId: number;
  reference: string;
  restaurantName: string;
  restaurantMarketplaceId: string;
  status: string;
  posDeliveryStatus: string;
  posDeliveryAttempts: number;
  posLastDeliveryError: string;
  posDeliveredAt: string | null;
  integrationProvider: string;
  integrationStatus: string;
  createdAt: string;
  webhookEvents: {
    id: number;
    eventType: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string;
    lastHttpStatus: number | null;
    nextAttemptAt: string | null;
    deliveredAt: string | null;
  }[];
};

export async function getOrderDeliveryStatus(
  reference: string,
): Promise<OrderDeliveryView | null> {
  const [row] = await db
    .select({
      orderId: orders.id,
      reference: orders.reference,
      restaurantName: restaurants.name,
      restaurantMarketplaceId: restaurants.marketplaceId,
      status: orders.status,
      posDeliveryStatus: orders.posDeliveryStatus,
      posDeliveryAttempts: orders.posDeliveryAttempts,
      posLastDeliveryError: orders.posLastDeliveryError,
      posDeliveredAt: orders.posDeliveredAt,
      integrationProvider: restaurantIntegrations.provider,
      integrationStatus: restaurantIntegrations.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .leftJoin(
      restaurantIntegrations,
      eq(restaurantIntegrations.restaurantId, orders.restaurantId),
    )
    .where(eq(orders.reference, reference))
    .limit(1);

  if (!row) return null;

  const events = await db
    .select({
      id: webhookEvents.id,
      eventType: webhookEvents.eventType,
      status: webhookEvents.status,
      attempts: webhookEvents.attempts,
      maxAttempts: webhookEvents.maxAttempts,
      lastError: webhookEvents.lastError,
      lastHttpStatus: webhookEvents.lastHttpStatus,
      nextAttemptAt: webhookEvents.nextAttemptAt,
      deliveredAt: webhookEvents.deliveredAt,
    })
    .from(webhookEvents)
    .where(eq(webhookEvents.orderId, row.orderId))
    .orderBy(desc(webhookEvents.createdAt));

  return {
    ...row,
    posDeliveredAt: row.posDeliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    integrationProvider: row.integrationProvider ?? "manual",
    integrationStatus: row.integrationStatus ?? "disconnected",
    webhookEvents: events.map((e) => ({
      ...e,
      nextAttemptAt: e.nextAttemptAt?.toISOString() ?? null,
      deliveredAt: e.deliveredAt?.toISOString() ?? null,
    })),
  };
}

/**
 * PHASE 16 — list recent orders with their POS delivery status, integration
 * state, and (batched) webhook delivery log. Drives the admin delivery queue.
 */
export async function getOrderDeliveryList(
  limit = 40,
  statuses?: string[],
): Promise<OrderDeliveryView[]> {
  const conditions = statuses && statuses.length > 0
    ? inArray(orders.posDeliveryStatus, statuses)
    : undefined;

  const rows = await db
    .select({
      orderId: orders.id,
      reference: orders.reference,
      restaurantName: restaurants.name,
      restaurantMarketplaceId: restaurants.marketplaceId,
      status: orders.status,
      posDeliveryStatus: orders.posDeliveryStatus,
      posDeliveryAttempts: orders.posDeliveryAttempts,
      posLastDeliveryError: orders.posLastDeliveryError,
      posDeliveredAt: orders.posDeliveredAt,
      integrationProvider: restaurantIntegrations.provider,
      integrationStatus: restaurantIntegrations.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .leftJoin(
      restaurantIntegrations,
      eq(restaurantIntegrations.restaurantId, orders.restaurantId),
    )
    .where(conditions)
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  const orderIds = rows.map((r) => r.orderId);
  let events: {
    id: number;
    orderId: number | null;
    eventType: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string;
    lastHttpStatus: number | null;
    nextAttemptAt: Date | null;
    deliveredAt: Date | null;
  }[] = [];
  if (orderIds.length > 0) {
    events = await db
      .select({
        id: webhookEvents.id,
        orderId: webhookEvents.orderId,
        eventType: webhookEvents.eventType,
        status: webhookEvents.status,
        attempts: webhookEvents.attempts,
        maxAttempts: webhookEvents.maxAttempts,
        lastError: webhookEvents.lastError,
        lastHttpStatus: webhookEvents.lastHttpStatus,
        nextAttemptAt: webhookEvents.nextAttemptAt,
        deliveredAt: webhookEvents.deliveredAt,
      })
      .from(webhookEvents)
      .where(
        and(inArray(webhookEvents.orderId, orderIds), eq(webhookEvents.direction, "outbound")),
      )
      .orderBy(desc(webhookEvents.createdAt));
  }

  const byOrder = new Map<number, typeof events>();
  for (const e of events) {
    const list = byOrder.get(e.orderId ?? 0) ?? [];
    list.push(e);
    byOrder.set(e.orderId ?? 0, list);
  }

  return rows.map((r) => ({
    ...r,
    posDeliveredAt: r.posDeliveredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    integrationProvider: r.integrationProvider ?? "manual",
    integrationStatus: r.integrationStatus ?? "disconnected",
    webhookEvents: (byOrder.get(r.orderId) ?? []).map((e) => ({
      ...e,
      nextAttemptAt: e.nextAttemptAt?.toISOString() ?? null,
      deliveredAt: e.deliveredAt?.toISOString() ?? null,
    })),
  }));
}
