import { db } from "@/db";
import {
  restaurants,
  marketplaceProfiles,
  categories,
  menuItems,
  reviews,
  orders,
  orderItems,
} from "@/db/schema";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
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
