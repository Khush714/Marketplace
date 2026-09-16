import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { menuItems, orders, restaurants, type OrderItemSnapshot } from "@/db/schema";
import {
  DELIVERY_FEE_CENTS,
  DELIVERY_FREE_ABOVE_CENTS,
  makeOrderCode,
  orderProgress,
  PLATFORM_FEE_CENTS,
} from "@/lib/domain";
import type {
  MenuItemDto,
  MenuSection,
  OrderDto,
  RestaurantDto,
  SearchResult,
} from "@/lib/types";

/* ------------------------------- mappers --------------------------------- */

function toRestaurantDto(r: typeof restaurants.$inferSelect): RestaurantDto {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline,
    cuisines: r.cuisines,
    rating: r.rating,
    ratingsCount: r.ratingsCount,
    priceLevel: r.priceLevel,
    deliveryMinutes: r.deliveryMinutes,
    distanceKm: r.distanceKm,
    offer: r.offer,
    imageUrl: r.imageUrl,
    heroUrl: r.heroUrl,
    featured: r.featured,
    pureVeg: r.pureVeg,
    locality: r.locality,
  };
}

function toMenuItemDto(m: typeof menuItems.$inferSelect): MenuItemDto {
  return {
    id: m.id,
    restaurantId: m.restaurantId,
    category: m.category,
    name: m.name,
    description: m.description,
    priceCents: m.priceCents,
    imageUrl: m.imageUrl,
    isVeg: m.isVeg,
    isBestseller: m.isBestseller,
  };
}

function toOrderDto(o: typeof orders.$inferSelect): OrderDto {
  const p = orderProgress(new Date(o.createdAt));
  return {
    id: o.id,
    code: o.code,
    restaurantSlug: o.restaurantSlug,
    restaurantName: o.restaurantName,
    items: o.items as OrderItemSnapshot[],
    addressLabel: o.addressLabel,
    addressText: o.addressText,
    customerName: o.customerName,
    phone: o.phone,
    paymentMethod: o.paymentMethod,
    instructions: o.instructions,
    riderName: o.riderName,
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    platformFeeCents: o.platformFeeCents,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    createdAt: new Date(o.createdAt).toISOString(),
    status: {
      stageIndex: p.stageIndex,
      stageKey: p.stage.key,
      stageLabel: p.stage.label,
      stageSub: p.stage.sub,
      delivered: p.delivered,
      riderProgress: p.riderProgress,
      etaIso: p.eta.toISOString(),
      etaSeconds: p.etaSeconds,
    },
  };
}

/* ---------------------------- restaurant reads --------------------------- */

export interface BrowseFilters {
  q?: string;
  cuisine?: string;
  sort?: "rating" | "fast" | "near" | "price-low" | "price-high";
  offers?: boolean;
  minRating?: boolean;
  veg?: boolean;
}

export async function browseRestaurants(filters: BrowseFilters = {}): Promise<RestaurantDto[]> {
  const conditions = [];
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(restaurants.name, like),
        ilike(restaurants.tagline, like),
        sql`exists (select 1 from unnest(${restaurants.cuisines}) c where c ilike ${like})`,
      ),
    );
  }
  if (filters.cuisine) {
    conditions.push(sql`${filters.cuisine} = any(${restaurants.cuisines})`);
  }
  if (filters.offers) conditions.push(sql`${restaurants.offer} is not null`);
  if (filters.minRating) conditions.push(gt(restaurants.rating, 4.5));
  if (filters.veg) conditions.push(eq(restaurants.pureVeg, true));

  const orderBy =
    filters.sort === "rating"
      ? [desc(restaurants.rating)]
      : filters.sort === "fast"
        ? [asc(restaurants.deliveryMinutes)]
        : filters.sort === "price-low"
          ? [asc(restaurants.priceLevel)]
          : filters.sort === "price-high"
            ? [desc(restaurants.priceLevel)]
            : filters.sort === "near"
              ? [asc(restaurants.distanceKm)]
              : [desc(restaurants.featured), desc(restaurants.rating)];

  const rows = await db
    .select()
    .from(restaurants)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderBy);
  return rows.map(toRestaurantDto);
}

export async function featuredRestaurants(): Promise<RestaurantDto[]> {
  const rows = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.featured, true))
    .orderBy(desc(restaurants.rating));
  return rows.map(toRestaurantDto);
}

export async function getRestaurant(slug: string) {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.slug, slug)).limit(1);
  if (!r) return null;
  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.restaurantId, r.id))
    .orderBy(asc(menuItems.sort));

  const byCategory = new Map<string, MenuItemDto[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(toMenuItemDto(item));
    byCategory.set(item.category, list);
  }
  const sections: MenuSection[] = [...byCategory.entries()].map(([category, list]) => ({
    category,
    items: list,
  }));
  const recommended = items.filter((i) => i.isBestseller).map(toMenuItemDto);

  return {
    restaurant: toRestaurantDto(r),
    sections,
    recommended,
    itemCount: items.length,
  };
}

/* --------------------------------- search -------------------------------- */

export async function searchAll(q: string): Promise<SearchResult[]> {
  const like = `%${q}%`;
  const restRows = await db
    .select()
    .from(restaurants)
    .where(
      or(
        ilike(restaurants.name, like),
        ilike(restaurants.tagline, like),
        sql`exists (select 1 from unnest(${restaurants.cuisines}) c where c ilike ${like})`,
      ),
    )
    .orderBy(desc(restaurants.rating))
    .limit(5);

  const restResults: SearchResult[] = restRows.map((r) => ({
    type: "restaurant",
    slug: r.slug,
    name: r.name,
    cuisines: r.cuisines,
    rating: r.rating,
    deliveryMinutes: r.deliveryMinutes,
    imageUrl: r.imageUrl,
    offer: r.offer,
  }));

  const dishLike = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      priceCents: menuItems.priceCents,
      isVeg: menuItems.isVeg,
      imageUrl: menuItems.imageUrl,
      restaurantSlug: restaurants.slug,
      restaurantName: restaurants.name,
    })
    .from(menuItems)
    .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
    .where(or(ilike(menuItems.name, like), ilike(menuItems.description, like)))
    .orderBy(desc(menuItems.isBestseller))
    .limit(6);

  // Deduplicate: favourite dishes whose restaurant already matched still surfaced as dishes
  const dishResults: SearchResult[] = dishLike.map((d) => ({
    type: "dish",
    id: d.id,
    name: d.name,
    priceCents: d.priceCents,
    isVeg: d.isVeg,
    imageUrl: d.imageUrl,
    restaurantSlug: d.restaurantSlug,
    restaurantName: d.restaurantName,
  }));

  return [...restResults, ...dishResults];
}

export async function restaurantsBySlugs(slugs: string[]): Promise<RestaurantDto[]> {
  if (!slugs.length) return [];
  const rows = await db.select().from(restaurants).where(inArray(restaurants.slug, slugs));
  return rows.map(toRestaurantDto);
}

/* --------------------------------- orders -------------------------------- */

export interface CreateOrderInput {
  restaurantSlug: string;
  items: Array<{ menuItemId: number; quantity: number }>;
  addressLabel: string;
  addressText: string;
  customerName: string;
  phone: string;
  paymentMethod: string;
  instructions?: string;
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<{ ok: true; order: OrderDto } | { ok: false; error: string }> {
  const [r] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.slug, input.restaurantSlug))
    .limit(1);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!input.items.length) return { ok: false, error: "Cart is empty" };

  const ids = input.items.map((i) => i.menuItemId);
  const rows = await db.select().from(menuItems).where(inArray(menuItems.id, ids));
  const byId = new Map(rows.map((m) => [m.id, m]));

  const snapshot: OrderItemSnapshot[] = [];
  let subtotal = 0;
  for (const item of input.items) {
    const m = byId.get(item.menuItemId);
    if (!m || m.restaurantId !== r.id) return { ok: false, error: "Invalid item in cart" };
    const qty = Math.min(20, Math.max(1, Math.floor(item.quantity) || 1));
    subtotal += m.priceCents * qty;
    snapshot.push({
      menuItemId: m.id,
      name: m.name,
      priceCents: m.priceCents,
      quantity: qty,
      imageUrl: m.imageUrl,
      isVeg: m.isVeg,
    });
  }

  let discount = 0;
  if (r.offerPercent > 0) {
    discount = Math.min(Math.round((subtotal * r.offerPercent) / 100), r.offerMaxCents);
  } else if (r.offerMaxCents > 0 && subtotal >= r.offerMaxCents * 3) {
    discount = r.offerMaxCents;
  }

  const deliveryFee = subtotal >= DELIVERY_FREE_ABOVE_CENTS ? 0 : DELIVERY_FEE_CENTS;
  const platformFee = PLATFORM_FEE_CENTS;
  const total = subtotal - discount + deliveryFee + platformFee;

  const [created] = await db
    .insert(orders)
    .values({
      code: makeOrderCode(),
      restaurantId: r.id,
      restaurantName: r.name,
      restaurantSlug: r.slug,
      items: snapshot,
      addressLabel: input.addressLabel,
      addressText: input.addressText,
      customerName: input.customerName,
      phone: input.phone,
      paymentMethod: input.paymentMethod,
      instructions: input.instructions ?? "",
      riderName: ["Arjun Mehta", "Ravi Kumar", "Sana Sheikh", "Dev Patil"][Math.floor(Math.random() * 4)],
      subtotalCents: subtotal,
      deliveryFeeCents: deliveryFee,
      platformFeeCents: platformFee,
      discountCents: discount,
      totalCents: total,
    })
    .returning();

  return { ok: true, order: toOrderDto(created) };
}

export async function getOrderByCode(code: string): Promise<OrderDto | null> {
  const [o] = await db.select().from(orders).where(eq(orders.code, code.toUpperCase())).limit(1);
  return o ? toOrderDto(o) : null;
}

export async function listOrders(codes: string[]): Promise<OrderDto[]> {
  if (!codes.length) return [];
  const upper = codes.map((c) => c.toUpperCase());
  const rows = await db
    .select()
    .from(orders)
    .where(inArray(orders.code, upper))
    .orderBy(desc(orders.createdAt))
    .limit(30);
  return rows.map(toOrderDto);
}
