import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { externalOrderIdFor } from "@/db/pos-delivery";
import {
  connectionCodes,
  connections,
  integrationAudit,
  integrationRecords,
  integrationSessions,
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  orders,
  restaurants,
  type OrderItemSnapshot,
} from "@/db/schema";
import {
  billFor,
  DEFAULT_LOCALITY,
  DEFAULT_RESTAURANT_HERO,
  DEFAULT_RESTAURANT_IMAGE,
  INTEGRATION_SESSION_TTL_MS,
  LOCALITIES,
  makeConnectionCode,
  makeOrderCode,
  orderProgress,
  ORDER_STAGES,
  type BillBreakdown,
} from "@/lib/domain";
import { hashOwnerKey, hashToken, makeAccessToken, makeMarketplaceId, makeOwnerKey, ownerKeyMatches } from "@/lib/owner-key";
import { statusRank } from "@/integrations/pos/order-status";
import { OUTLET_ERROR_MESSAGES, resolveOutletForRestaurant } from "@/integrations/pos/resolve-outlet";
import type {
  ConnectionCodeDto,
  ConnectionDto,
  MenuItemDto,
  MenuSection,
  ModifierGroupDto,
  OrderDto,
  OrderLifecycleStage,
  OrderStatusDto,
  RestaurantDto,
  RestaurantManageDto,
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
    marketplaceId: r.marketplaceId ?? null,
  };
}

function toMenuItemDto(
  m: typeof menuItems.$inferSelect,
  modifierGroups?: ModifierGroupDto[],
): MenuItemDto {
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
    ...(modifierGroups?.length ? { modifierGroups } : {}),
  };
}

/**
 * Real POS lifecycle → tracking view. Used only for orders that actually
 * crossed the POS bridge; everything else keeps the elapsed-time demo timeline.
 */
const INTEGRATION_TRACKING_STAGES: Record<string, OrderLifecycleStage> = {
  PLACED: {
    stageIndex: 0,
    stageKey: "placed",
    stageLabel: "Order placed",
    stageSub: "Waiting for the restaurant to accept",
    delivered: false,
    riderProgress: 0,
  },
  ACCEPTED: {
    stageIndex: 1,
    stageKey: "accepted",
    stageLabel: "Order accepted",
    stageSub: "The restaurant confirmed your order",
    delivered: false,
    riderProgress: 0,
  },
  PREPARING: {
    stageIndex: 2,
    stageKey: "preparing",
    stageLabel: "Being prepared",
    stageSub: "Chefs are on it",
    delivered: false,
    riderProgress: 0,
  },
  READY: {
    stageIndex: 3,
    stageKey: "ready",
    stageLabel: "Order ready",
    stageSub: "Packed & sealed for delivery",
    delivered: false,
    riderProgress: 0.1,
  },
  OUT_FOR_DELIVERY: {
    stageIndex: 4,
    stageKey: "out_for_delivery",
    stageLabel: "Out for delivery",
    stageSub: "Your rider is on the way",
    delivered: false,
    riderProgress: 0.6,
  },
  DELIVERED: {
    stageIndex: 5,
    stageKey: "delivered",
    stageLabel: "Delivered",
    stageSub: "Enjoy your meal",
    delivered: true,
    riderProgress: 1,
  },
  COMPLETED: {
    stageIndex: 6,
    stageKey: "delivered",
    stageLabel: "Delivered",
    stageSub: "Enjoy your meal",
    delivered: true,
    riderProgress: 1,
  },
  CANCELLED: {
    stageIndex: 7,
    stageKey: "cancelled",
    stageLabel: "Order cancelled",
    stageSub: "This order was cancelled",
    delivered: false,
    riderProgress: 0,
  },
  REJECTED: {
    stageIndex: 8,
    stageKey: "rejected",
    stageLabel: "Order rejected",
    stageSub: "The restaurant couldn't take this order",
    delivered: false,
    riderProgress: 0,
  },
};

const MAINLINE_STAGE_KEYS = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
];

/**
 * Full canonical step list for the tracking UI, derived solely from the current
 * order status (spec: no mapping lives in components). Terminals show the
 * mainline reached so far plus their own settlement step.
 */
function integrationStagesFor(current: string): OrderLifecycleStage[] {
  const reachedIndex =
    current === "CANCELLED" || current === "REJECTED"
      ? current === "CANCELLED"
        ? 2
        : 0
      : Math.max(0, statusRank(current));
  return MAINLINE_STAGE_KEYS.map((key) => {
    const s = INTEGRATION_TRACKING_STAGES[key];
    return { ...s, delivered: s.stageIndex <= reachedIndex };
  });
}

// Elapsed-time estimate for POS-tracked orders that are still travelling.
const INTEGRATION_ETA_SECONDS: Record<string, number> = {
  PLACED: 1800,
  ACCEPTED: 1800,
  PREPARING: 1500,
  READY: 900,
  OUT_FOR_DELIVERY: 1200,
  DELIVERED: 0,
  COMPLETED: 0,
  CANCELLED: 0,
  REJECTED: 0,
};

function toOrderDto(o: typeof orders.$inferSelect): OrderDto {
  const integrated = o.externalOrderId != null || o.posOrderId != null;
  const status = integrated ? integrationOrderStatus(o) : demoOrderStatus(o);
  return {
    id: o.id,
    code: o.code,
    restaurantSlug: o.restaurantSlug,
    restaurantName: o.restaurantName,
    restaurantId: o.restaurantId,
    externalOrderId: o.externalOrderId,
    items: o.items as OrderItemSnapshot[],
    addressLabel: o.addressLabel,
    addressText: o.addressText,
    customerName: o.customerName,
    phone: o.phone,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    instructions: o.instructions,
    riderName: o.riderName,
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    platformFeeCents: o.platformFeeCents,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    createdAt: new Date(o.createdAt).toISOString(),
    status,
  };
}

/** Demo/legacy timeline (elapsed-time accelerated journey). */
function demoOrderStatus(o: typeof orders.$inferSelect): OrderStatusDto {
  const p = orderProgress(new Date(o.createdAt));
  return {
    stageIndex: p.stageIndex,
    stageKey: p.stage.key,
    stageLabel: p.stage.label,
    stageSub: p.stage.sub,
    delivered: p.delivered,
    riderProgress: p.riderProgress,
    etaIso: p.eta.toISOString(),
    etaSeconds: p.etaSeconds,
    statusUpdatedAt: null,
    cancellable: false,
    cancelReason: "This order was placed on a demo timeline",
    stages: ORDER_STAGES.map((st) => ({
      stageIndex: ORDER_STAGES.indexOf(st),
      stageKey: st.key,
      stageLabel: st.label,
      stageSub: st.sub,
      delivered: ORDER_STAGES.indexOf(st) <= p.stageIndex,
      riderProgress: p.stageIndex >= 3 ? p.riderProgress : 0,
    })),
  };
}

/** Real POS lifecycle status surfaced through the same OrderStatusDto shape. */
function integrationOrderStatus(o: typeof orders.$inferSelect): OrderStatusDto {
  const s =
    INTEGRATION_TRACKING_STAGES[o.integrationStatus] ?? Object.values(INTEGRATION_TRACKING_STAGES)[0];
  const etaSeconds = INTEGRATION_ETA_SECONDS[o.integrationStatus] ?? 0;
  const cancellable =
    o.externalOrderId != null &&
    (o.integrationStatus === "PLACED" || o.integrationStatus === "ACCEPTED" || o.integrationStatus === "PREPARING");
  return {
    ...s,
    etaIso: new Date(Date.now() + etaSeconds * 1000).toISOString(),
    etaSeconds,
    statusUpdatedAt: o.statusUpdatedAt ? new Date(o.statusUpdatedAt).toISOString() : null,
    cancellable,
    cancelReason: cancellable ? null : "This order is past the cancellable stage",
    stages: integrationStagesFor(o.integrationStatus),
  };
}

/* ---------------------------- restaurant reads --------------------------- */

export interface BrowseFilters {
  q?: string;
  cuisine?: string;
  locality?: string;
  sort?: "rating" | "fast" | "near" | "price-low" | "price-high";
  offers?: boolean;
  minRating?: boolean;
  veg?: boolean;
}

export async function browseRestaurants(filters: BrowseFilters = {}): Promise<RestaurantDto[]> {
  const conditions: (SQL | undefined)[] = [eq(restaurants.isActive, true)];
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
  if (filters.locality) conditions.push(eq(restaurants.locality, filters.locality));
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

export async function featuredRestaurants(locality?: string): Promise<RestaurantDto[]> {
  const conditions = [eq(restaurants.isActive, true), eq(restaurants.featured, true)];
  if (locality) conditions.push(eq(restaurants.locality, locality));
  const rows = await db
    .select()
    .from(restaurants)
    .where(and(...conditions))
    .orderBy(desc(restaurants.rating));
  return rows.map(toRestaurantDto);
}

export async function getRestaurant(slug: string) {
  const [r] = await db
    .select()
    .from(restaurants)
    .where(and(eq(restaurants.slug, slug), eq(restaurants.isActive, true)))
    .limit(1);
  if (!r) return null;
  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.restaurantId, r.id))
    .orderBy(asc(menuItems.sort));

  const byCategory = new Map<string, MenuItemDto[]>();
  const modifierGroupsByItem = await getMenuModifierGroups(
    r.id,
    items.map((i) => i.id),
  );
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(toMenuItemDto(item, modifierGroupsByItem.get(item.id)));
    byCategory.set(item.category, list);
  }
  const sections: MenuSection[] = [...byCategory.entries()].map(([category, list]) => ({
    category,
    items: list,
  }));
  const recommended = items
    .filter((i) => i.isBestseller)
    .map((i) => toMenuItemDto(i, modifierGroupsByItem.get(i.id)));

  return {
    restaurant: toRestaurantDto(r),
    sections,
    recommended,
    itemCount: items.length,
  };
}

/* --------------------------------- search -------------------------------- */

export async function searchAll(q: string, locality?: string): Promise<SearchResult[]> {
  const like = `%${q}%`;
  const restaurantCondition = and(
    eq(restaurants.isActive, true),
    or(
      ilike(restaurants.name, like),
      ilike(restaurants.tagline, like),
      sql`exists (select 1 from unnest(${restaurants.cuisines}) c where c ilike ${like})`,
    ),
  );
  const restRows = await db
    .select()
    .from(restaurants)
    .where(locality ? and(restaurantCondition, eq(restaurants.locality, locality)) : restaurantCondition)
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
    .where(
      locality
        ? and(
            eq(restaurants.isActive, true),
            or(ilike(menuItems.name, like), ilike(menuItems.description, like)),
            eq(restaurants.locality, locality),
          )
        : and(
            eq(restaurants.isActive, true),
            or(ilike(menuItems.name, like), ilike(menuItems.description, like)),
          ),
    )
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
  const rows = await db
    .select()
    .from(restaurants)
    .where(and(eq(restaurants.isActive, true), inArray(restaurants.slug, slugs)));
  return rows.map(toRestaurantDto);
}

/* --------------------------- connection codes ---------------------------- */

function toConnectionCodeDto(
  c: typeof connectionCodes.$inferSelect,
  restaurantId: number | null = null,
  restaurantName: string | null = null,
): ConnectionCodeDto {
  return {
    id: c.id,
    code: c.code,
    status: c.status === "used" ? "used" : "unused",
    restaurantId,
    restaurantName,
    createdAt: new Date(c.createdAt).toISOString(),
    usedAt: c.usedAt ? new Date(c.usedAt).toISOString() : null,
    expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
  };
}

export async function listConnectionCodes(limit = 30): Promise<ConnectionCodeDto[]> {
  const rows = await db
    .select({
      c: connectionCodes,
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
    })
    .from(connectionCodes)
    .leftJoin(connections, eq(connections.codeId, connectionCodes.id))
    .leftJoin(restaurants, eq(restaurants.id, connections.restaurantId))
    .orderBy(desc(connectionCodes.createdAt))
    .limit(limit);
  return rows.map(({ c, restaurantId, restaurantName }) =>
    toConnectionCodeDto(c, restaurantId ?? null, restaurantName ?? null),
  );
}

export async function mintConnectionCode(daysValid = 0): Promise<ConnectionCodeDto> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = makeConnectionCode();
    const [hit] = await db
      .select()
      .from(connectionCodes)
      .where(eq(connectionCodes.code, code))
      .limit(1);
    if (hit) continue;
    const expiresAt = daysValid > 0 ? new Date(Date.now() + daysValid * 86400000) : null;
    const [row] = await db.insert(connectionCodes).values({ code, expiresAt }).returning();
    if (row) return toConnectionCodeDto(row);
  }
  throw new Error("Could not mint a unique connection code");
}

export async function getConnectionCode(code: string): Promise<ConnectionCodeDto | null> {
  const [row] = await db
    .select({
      c: connectionCodes,
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
    })
    .from(connectionCodes)
    .leftJoin(connections, eq(connections.codeId, connectionCodes.id))
    .leftJoin(restaurants, eq(restaurants.id, connections.restaurantId))
    .where(eq(connectionCodes.code, code.toUpperCase()))
    .limit(1);
  return row
    ? toConnectionCodeDto(row.c, row.restaurantId ?? null, row.restaurantName ?? null)
    : null;
}

export async function listConnections(limit = 30): Promise<ConnectionDto[]> {
  const rows = await db
    .select({
      c: connections,
      code: connectionCodes.code,
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
    })
    .from(connections)
    .innerJoin(connectionCodes, eq(connectionCodes.id, connections.codeId))
    .innerJoin(restaurants, eq(restaurants.id, connections.restaurantId))
    .orderBy(desc(connections.connectedAt))
    .limit(limit);
  return rows.map(({ c, code, restaurantId, restaurantName, restaurantSlug }) => ({
    id: c.id,
    code,
    restaurantId,
    restaurantName,
    restaurantSlug,
    marketplace: c.marketplace,
    status: c.status,
    connectedAt: new Date(c.connectedAt).toISOString(),
  }));
}

export interface RedeemConnectionInput {
  code: string;
  name: string;
  tagline?: string;
  cuisines: string[];
  locality: string;
  externalId: string;
  imageUrl?: string;
  heroUrl?: string;
}

class CodeAlreadyUsedError extends Error {}
class ExternalIdTakenError extends Error {}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "kitchen";
}

async function uniqueRestaurantSlug(
  exists: (candidate: string) => Promise<boolean>,
  base: string,
): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "23505"
  );
}

/** Spend a one-time code and bridge it to a freshly onboarded restaurant. */
export async function redeemConnectionCode(
  input: RedeemConnectionInput,
): Promise<
  | { ok: true; restaurant: RestaurantDto; ownerKey: string }
  | { ok: false; error: string }
> {
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter the connection code" };

  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Restaurant name is required" };

  const externalId = String(input.externalId ?? "").trim().slice(0, 64);
  if (!externalId) return { ok: false, error: "Marketplace store ID is required" };

  const cuisines = (Array.isArray(input.cuisines) ? input.cuisines : [])
    .map((c) => String(c).trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 4);
  if (!cuisines.length) return { ok: false, error: "At least one cuisine is required" };

  const locality = LOCALITIES.some((l) => l.name === input.locality) ? input.locality : DEFAULT_LOCALITY.name;

  const [c] = await db
    .select()
    .from(connectionCodes)
    .where(eq(connectionCodes.code, code))
    .limit(1);
  if (!c) return { ok: false, error: "Connection code not found" };
  if (c.status === "used") return { ok: false, error: "Connection code already used" };
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { ok: false, error: "Connection code has expired" };

  const ownerKey = makeOwnerKey();
  const ownerKeyHash = hashOwnerKey(ownerKey);

  try {
    const restaurant = await db.transaction(async (tx) => {
      // Atomic spend — only one concurrent redeemer can flip the code.
      const [spent] = await tx
        .update(connectionCodes)
        .set({ status: "used", usedAt: new Date() })
        .where(and(eq(connectionCodes.id, c.id), eq(connectionCodes.status, "unused")))
        .returning({ id: connectionCodes.id });
      if (!spent) throw new CodeAlreadyUsedError();

      const [existing] = await tx
        .select()
        .from(restaurants)
        .where(eq(restaurants.externalId, externalId))
        .limit(1);
      if (existing) throw new ExternalIdTakenError();

      const exists = async (candidate: string) =>
        (
          await tx
            .select({ id: restaurants.id })
            .from(restaurants)
            .where(eq(restaurants.slug, candidate))
            .limit(1)
        ).length > 0;
      const slug = await uniqueRestaurantSlug(exists, slugify(name));

      const [r] = await tx
        .insert(restaurants)
        .values({
          slug,
          name,
          tagline: String(input.tagline ?? "").trim().slice(0, 80),
          cuisines,
          locality,
          externalId,
          marketplaceId: makeMarketplaceId(),
          ownerKeyHash,
          imageUrl: String(input.imageUrl ?? "").trim() || DEFAULT_RESTAURANT_IMAGE,
          heroUrl: String(input.heroUrl ?? "").trim() || DEFAULT_RESTAURANT_HERO,
        })
        .returning();

      await tx.insert(connections).values({ codeId: c.id, restaurantId: r.id });
      return r;
    });

    return { ok: true, restaurant: toRestaurantDto(restaurant), ownerKey };
  } catch (e) {
    if (e instanceof CodeAlreadyUsedError) return { ok: false, error: "Connection code already used" };
    if (e instanceof ExternalIdTakenError || isUniqueViolation(e)) {
      return { ok: false, error: "This store ID is already connected to another restaurant" };
    }
    throw e;
  }
}

/** Restaurant-side handshake: present the owner key to prove control of a listing. */
export async function verifyOwner(ownerKey: string): Promise<RestaurantDto | null> {
  const key = String(ownerKey ?? "").trim();
  if (!key) return null;
  const [r] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.ownerKeyHash, hashOwnerKey(key)))
    .limit(1);
  return r ? toRestaurantDto(r) : null;
}

function toRestaurantManageDto(r: typeof restaurants.$inferSelect): RestaurantManageDto {
  return { ...toRestaurantDto(r), isActive: r.isActive };
}

/** Full listing (plus live state) for the owner who holds the key. */
export async function getRestaurantByOwnerKey(ownerKey: string): Promise<RestaurantManageDto | null> {
  const key = String(ownerKey ?? "").trim();
  if (!key) return null;
  const [r] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.ownerKeyHash, hashOwnerKey(key)))
    .limit(1);
  return r ? toRestaurantManageDto(r) : null;
}

/** Pause (isActive=false) or resume (isActive=true) an owner's listing. */
export async function setRestaurantActive(
  ownerKey: string,
  active: boolean,
): Promise<
  { ok: true; restaurant: RestaurantManageDto } | { ok: false; error: string }
> {
  const key = String(ownerKey ?? "").trim();
  if (!key) return { ok: false, error: "Owner key is required" };
  const [r] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.ownerKeyHash, hashOwnerKey(key)))
    .limit(1);
  if (!r) return { ok: false, error: "Invalid owner key" };
  const next = Boolean(active);
  if (r.isActive !== next) {
    await db.update(restaurants).set({ isActive: next }).where(eq(restaurants.id, r.id));
  }
  return { ok: true, restaurant: toRestaurantManageDto({ ...r, isActive: next }) };
}

/**
 * Permanently remove an owner's listing together with its menu, connection,
 * integration sessions and order history. Requires the exact restaurant name
 * as an explicit, typed confirmation.
 */
export async function deleteRestaurant(
  ownerKey: string,
  confirmName: string,
): Promise<{ ok: true; restaurantName: string } | { ok: false; error: string }> {
  const key = String(ownerKey ?? "").trim();
  if (!key) return { ok: false, error: "Owner key is required" };
  const [r] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.ownerKeyHash, hashOwnerKey(key)))
    .limit(1);
  if (!r) return { ok: false, error: "Invalid owner key" };
  if (String(confirmName ?? "").trim().toLowerCase() !== r.name.toLowerCase()) {
    return { ok: false, error: "Restaurant name does not match" };
  }
  await db.transaction(async (tx) => {
    await tx.delete(orders).where(eq(orders.restaurantId, r.id));
    await tx.delete(connections).where(eq(connections.restaurantId, r.id));
    await tx.delete(integrationSessions).where(eq(integrationSessions.restaurantId, r.id));
    await tx.delete(menuItems).where(eq(menuItems.restaurantId, r.id));
    await tx.delete(restaurants).where(eq(restaurants.id, r.id));
  });
  return { ok: true, restaurantName: r.name };
}

/* ------------------------------ integration ------------------------------- */

export interface IntegrationIdentity {
  restaurant: RestaurantDto;
  codeId: number;
}

/**
 * The restaurant's "API key + secret" handshake: the minted connection code
 * acts as the login ID and the passkey (owner key) as the password. Both must
 * match the code -> connection -> restaurant chain.
 */
export async function authenticateIntegration(
  code: string,
  passkey: string,
): Promise<IntegrationIdentity | null> {
  const c = String(code ?? "").trim().toUpperCase();
  const p = String(passkey ?? "");
  if (!c || !p) return null;

  const [row] = await db
    .select({
      r: restaurants,
      c: connectionCodes,
    })
    .from(connectionCodes)
    .innerJoin(connections, eq(connections.codeId, connectionCodes.id))
    .innerJoin(restaurants, eq(restaurants.id, connections.restaurantId))
    .where(eq(connectionCodes.code, c))
    .limit(1);
  if (!row) return null;
  if (!ownerKeyMatches(row.r.ownerKeyHash, p)) return null;
  return { restaurant: toRestaurantDto(row.r), codeId: row.c.id };
}

export async function createIntegrationSession(
  identity: IntegrationIdentity,
): Promise<{ token: string; expiresAtIso: string }> {
  const token = makeAccessToken();
  const expires = new Date(Date.now() + INTEGRATION_SESSION_TTL_MS);
  await db.insert(integrationSessions).values({
    tokenHash: hashToken(token),
    restaurantId: identity.restaurant.id,
    codeId: identity.codeId,
    expiresAt: expires,
  });
  return { token, expiresAtIso: expires.toISOString() };
}

export async function getIntegrationSession(token: string): Promise<RestaurantDto | null> {
  const t = String(token ?? "").trim();
  if (!t) return null;
  const [row] = await db
    .select({
      s: integrationSessions,
      r: restaurants,
    })
    .from(integrationSessions)
    .innerJoin(restaurants, eq(restaurants.id, integrationSessions.restaurantId))
    .where(eq(integrationSessions.tokenHash, hashToken(t)))
    .limit(1);
  if (!row) return null;
  if (row.s.revokedAt) return null;
  if (new Date(row.s.expiresAt) <= new Date()) return null;
  await db
    .update(integrationSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(integrationSessions.id, row.s.id));
  return toRestaurantDto(row.r);
}

export async function listIntegrationOrders(restaurantId: number, limit = 30): Promise<OrderDto[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.restaurantId, restaurantId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  return rows.map(toOrderDto);
}

export async function rotatePasskey(
  code: string,
  currentPasskey: string,
): Promise<{ ok: true; passkey: string } | { ok: false; error: string }> {
  const identity = await authenticateIntegration(code, currentPasskey);
  if (!identity) return { ok: false, error: "Invalid credentials" };
  const next = makeOwnerKey();
  await db
    .update(restaurants)
    .set({ ownerKeyHash: hashOwnerKey(next) })
    .where(eq(restaurants.id, identity.restaurant.id));
  return { ok: true, passkey: next };
}

/* ------------------------------- identity -------------------------------- */

/**
 * Return the restaurant's canonical marketplace id, assigning a fresh one on
 * first access (backfills listings created before marketplace_id existed).
 */
export async function getOrCreateMarketplaceId(restaurantId: number): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [r] = await db
      .select({ marketplaceId: restaurants.marketplaceId })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    if (r?.marketplaceId) return r.marketplaceId;
    const id = makeMarketplaceId();
    const [updated] = await db
      .update(restaurants)
      .set({ marketplaceId: id })
      .where(eq(restaurants.id, restaurantId))
      .returning({ marketplaceId: restaurants.marketplaceId });
    if (updated?.marketplaceId) return updated.marketplaceId;
  }
  throw new Error("Could not assign a marketplace id");
}

/**
 * Reconcile the shared external identity once a POS claims the connection: the
 * Marketplace restaurant's marketplace_id (rst_…) and the POS's own
 * external_restaurant_id must be THE SAME value — order payloads route on it
 * (`order.restaurant_id`) and webhook receivers verify X-Integration-ID
 * against it. Returns the reconciled id.
 */
export async function syncMarketplaceId(restaurantId: number, rstId: string): Promise<string> {
  const id = String(rstId ?? "").trim().slice(0, 64);
  if (!id) return (await getOrCreateMarketplaceId(restaurantId)) || "";
  const [r] = await db
    .select({ marketplaceId: restaurants.marketplaceId })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (r?.marketplaceId === id) return id;
  const [u] = await db
    .update(restaurants)
    .set({ marketplaceId: id })
    .where(eq(restaurants.id, restaurantId))
    .returning({ marketplaceId: restaurants.marketplaceId });
  return u?.marketplaceId ?? id;
}

export interface IntegrationRecordDto {
  restaurantId: number;
  marketplaceId: string;
  provider: string;
  posRestaurantId: string | null;
  posBranchId: string | null;
  posOutletId: string | null;
  status: string;
  connectedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export async function getIntegrationRecord(restaurantId: number): Promise<IntegrationRecordDto | null> {
  const [row] = await db
    .select({
      rec: integrationRecords,
      marketplaceId: restaurants.marketplaceId,
    })
    .from(integrationRecords)
    .innerJoin(restaurants, eq(restaurants.id, integrationRecords.restaurantId))
    .where(eq(integrationRecords.restaurantId, restaurantId))
    .limit(1);
  if (!row) return null;
  return {
    restaurantId: row.rec.restaurantId,
    marketplaceId: row.marketplaceId ?? "",
    provider: row.rec.provider,
    posRestaurantId: row.rec.posRestaurantId,
    posBranchId: row.rec.posBranchId,
    posOutletId: row.rec.posOutletId,
    status: row.rec.status,
    connectedAt: row.rec.connectedAt ? new Date(row.rec.connectedAt).toISOString() : null,
    lastHeartbeatAt: row.rec.lastHeartbeatAt ? new Date(row.rec.lastHeartbeatAt).toISOString() : null,
    lastSyncAt: row.rec.lastSyncAt ? new Date(row.rec.lastSyncAt).toISOString() : null,
    lastError: row.rec.lastError,
  };
}

export interface UpsertIntegrationIdentityInput {
  restaurantId: number;
  provider?: string;
  posRestaurantId?: string | null;
  posBranchId?: string | null;
  posOutletId?: string | null;
  status?: "pending" | "active" | "disabled";
  heartbeat?: boolean;
  sync?: boolean;
  error?: string | null;
}

/** Create or update the one-to-one POS identity record for a restaurant. */
export async function upsertIntegrationIdentity(
  input: UpsertIntegrationIdentityInput,
): Promise<IntegrationRecordDto> {
  const rec = await db
    .insert(integrationRecords)
    .values({
      restaurantId: input.restaurantId,
      provider: input.provider ?? "restaurant-ai",
      posRestaurantId: input.posRestaurantId ?? null,
      posBranchId: input.posBranchId ?? null,
      posOutletId: input.posOutletId ?? null,
      status: input.status ?? "pending",
      connectedAt: new Date(),
      lastHeartbeatAt: input.heartbeat ? new Date() : undefined,
      lastSyncAt: input.sync ? new Date() : undefined,
      lastError: input.error ?? undefined,
    })
    .onConflictDoUpdate({
      target: integrationRecords.restaurantId,
      set: {
        provider: input.provider ?? integrationRecords.provider,
        posRestaurantId: input.posRestaurantId !== undefined ? input.posRestaurantId : integrationRecords.posRestaurantId,
        posBranchId: input.posBranchId !== undefined ? input.posBranchId : integrationRecords.posBranchId,
        posOutletId: input.posOutletId !== undefined ? input.posOutletId : integrationRecords.posOutletId,
        status: input.status ?? integrationRecords.status,
        connectedAt: input.status === "active" ? new Date() : integrationRecords.connectedAt,
        lastHeartbeatAt: input.heartbeat ? new Date() : integrationRecords.lastHeartbeatAt,
        lastSyncAt: input.sync ? new Date() : integrationRecords.lastSyncAt,
        lastError: input.error !== undefined ? input.error : integrationRecords.lastError,
        updatedAt: new Date(),
      },
    })
    .returning();

  const record = rec[0];
  const marketplaceId = await getOrCreateMarketplaceId(input.restaurantId);
  return {
    restaurantId: input.restaurantId,
    marketplaceId,
    provider: record.provider,
    posRestaurantId: record.posRestaurantId,
    posBranchId: record.posBranchId,
    posOutletId: record.posOutletId,
    status: record.status,
    connectedAt: record.connectedAt ? new Date(record.connectedAt).toISOString() : null,
    lastHeartbeatAt: record.lastHeartbeatAt ? new Date(record.lastHeartbeatAt).toISOString() : null,
    lastSyncAt: record.lastSyncAt ? new Date(record.lastSyncAt).toISOString() : null,
    lastError: record.lastError,
  };
}

/* -------------------------------- audit ---------------------------------- */

export type IntegrationAuditContext = {
  actor: "restaurant" | "partner" | "system";
  ipAddress?: string | null;
};

/** Append an entry to the integration audit trail (best-effort, never throws). */
export async function recordIntegrationAudit(
  restaurantId: number | null,
  event: string,
  ctx: IntegrationAuditContext,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(integrationAudit).values({
      restaurantId,
      actor: ctx.actor,
      event,
      detail: detail ?? {},
      ipAddress: ctx.ipAddress ?? null,
    });
  } catch {
    // The audit trail must never break the integration path it records.
  }
}

/** Revoke every live integration session for a restaurant. */
export async function revokeIntegrationSessions(restaurantId: number): Promise<void> {
  await db
    .update(integrationSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(integrationSessions.restaurantId, restaurantId), isNull(integrationSessions.revokedAt)));
}

/**
 * Rotate the passkey for an already-authenticated restaurant. Requires the
 * current passkey as proof so session theft cannot silently rotate credentials.
 */
export async function rotatePasskeyAsRestaurant(
  restaurantId: number,
  currentPasskey: string,
): Promise<{ ok: true; passkey: string } | { ok: false; error: string }> {
  const p = String(currentPasskey ?? "");
  if (!p) return { ok: false, error: "Current passkey is required" };
  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r || !ownerKeyMatches(r.ownerKeyHash, p)) return { ok: false, error: "Invalid passkey" };
  const next = makeOwnerKey();
  await db.update(restaurants).set({ ownerKeyHash: hashOwnerKey(next) }).where(eq(restaurants.id, restaurantId));
  return { ok: true, passkey: next };
}

/* --------------------------------- orders -------------------------------- */

export interface CartModifierSubmit {
  optionId: number;
  quantity?: number;
}

export interface CartLineSubmit {
  menuItemId: number;
  quantity: number;
  /** Client-held price snapshot; a mismatch flags stalePrice (billed at DB price). */
  priceCents?: number;
  modifiers?: CartModifierSubmit[];
}

export interface DroppedCartItem {
  menuItemId: number;
  name: string;
  reason: "sold_out" | string;
}

export interface CreateOrderInput {
  restaurantSlug: string;
  items: CartLineSubmit[];
  addressLabel: string;
  addressText: string;
  customerName: string;
  phone: string;
  paymentMethod: string;
  instructions?: string;
  /**
   * Client-generated idempotency key (e.g. checkout attempt id). Retried POSTs
   * carrying the same key return the originally created order instead of
   * producing a duplicate.
   */
  clientRequestId?: string;
  /**
   * Optional outlet claim (Phase 7). When present it must match the
   * restaurant's ACTIVE integration record outlet, else the checkout is
   * rejected (never silently routed to a different branch). Absent → legacy
   * store-level routing; the record's branch/outlet are persisted at delivery.
   */
  outletId?: string;
}

/** Linked modifier group + its available options, resolved per menu item. */
interface ItemModifierScope {
  group: typeof modifierGroups.$inferSelect;
  options: Map<number, typeof modifierOptions.$inferSelect>;
}

/**
 * Resolve a cart against the real menu and compute the exact bill createOrder
 * will record. Single lookup + single pricing path shared with createOrder so
 * the amount shown at payment always matches the recorded order total.
 *
 * Phase 3 extras (all additive — legacy carts without modifiers are priced
 * exactly as before): sold-out items are dropped (not billed), modifiers are
 * validated against their linked groups (min/max + DB prices), and a supplied
 * client price snapshot that differs from the DB price is flagged stale.
 */
export async function computeBill(
  restaurantSlug: string,
  items: CartLineSubmit[],
): Promise<
  | {
      ok: true;
      restaurant: typeof restaurants.$inferSelect;
      lines: {
        menuItem: typeof menuItems.$inferSelect;
        quantity: number;
        stalePrice: boolean;
        modifiers: { option: typeof modifierOptions.$inferSelect; quantity: number }[];
      }[];
      bill: BillBreakdown;
      dropped: DroppedCartItem[];
    }
  | { ok: false; error: string }
> {
  const [r] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.slug, restaurantSlug))
    .limit(1);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!r.isActive) return { ok: false, error: `${r.name} is temporarily closed` };
  if (!items.length) return { ok: false, error: "Cart is empty" };

  const ids = items.map((i) => i.menuItemId);
  const rows = await db.select().from(menuItems).where(inArray(menuItems.id, ids));
  const byId = new Map(rows.map((m) => [m.id, m]));

  const scopesByItem = await loadModifierScopes(r.id, ids);

  const lines: {
    menuItem: typeof menuItems.$inferSelect;
    quantity: number;
    stalePrice: boolean;
    modifiers: { option: typeof modifierOptions.$inferSelect; quantity: number }[];
  }[] = [];
  const dropped: DroppedCartItem[] = [];
  let subtotal = 0;

  for (const item of items) {
    const m = byId.get(item.menuItemId);
    if (!m || m.restaurantId !== r.id) return { ok: false, error: "Invalid item in cart" };
    const qty = Math.min(20, Math.max(1, Math.floor(item.quantity) || 1));

    if (!m.available) {
      dropped.push({ menuItemId: m.id, name: m.name, reason: "sold_out" });
      continue;
    }

    const selected = (item.modifiers ?? []).map((mod) => ({
      optionId: Math.floor(Number(mod.optionId)),
      quantity: Math.min(5, Math.max(1, Math.floor(mod.quantity ?? 1))),
    }));

    const scopes = scopesByItem.get(m.id) ?? [];
    const optionToGroup = new Map<number, ItemModifierScope>();
    for (const scope of scopes) {
      for (const optionId of scope.options.keys()) optionToGroup.set(optionId, scope);
    }

    const counts = new Map<number, number>();
    let modifierSubtotal = 0;
    const priced: { option: typeof modifierOptions.$inferSelect; quantity: number }[] = [];

    for (const sel of selected) {
      const scope = optionToGroup.get(sel.optionId);
      const option = scope?.options.get(sel.optionId);
      if (!scope || !option) return { ok: false, error: "Invalid modifier in cart" };
      counts.set(scope.group.id, (counts.get(scope.group.id) ?? 0) + 1);
      modifierSubtotal += option.priceCents * sel.quantity;
      priced.push({ option, quantity: sel.quantity });
    }

    for (const scope of scopes) {
      const selectedCount = counts.get(scope.group.id) ?? 0;
      if (selectedCount < scope.group.minSelect) {
        return {
          ok: false,
          error: `Select at least ${scope.group.minSelect} from ${scope.group.name}`,
        };
      }
      if (selectedCount > scope.group.maxSelect) {
        return {
          ok: false,
          error: `Select no more than ${scope.group.maxSelect} from ${scope.group.name}`,
        };
      }
    }

    const stalePrice = item.priceCents !== undefined && item.priceCents !== m.priceCents;
    const lineSubtotal = m.priceCents * qty + modifierSubtotal;
    subtotal += lineSubtotal;
    lines.push({ menuItem: m, quantity: qty, stalePrice, modifiers: priced });
  }

  const bill = billFor(subtotal, r.offerPercent, r.offerMaxCents);
  return { ok: true, restaurant: r, lines, bill, dropped };
}

/** Load active modifier scopes (group + available options) for menu items. */
async function loadModifierScopes(
  restaurantId: number,
  menuItemIds: number[],
): Promise<Map<number, ItemModifierScope[]>> {
  const scopesByItem = new Map<number, ItemModifierScope[]>();
  if (!menuItemIds.length) return scopesByItem;

  const links = await db
    .select({
      menuItemId: menuItemModifierGroups.menuItemId,
      groupId: menuItemModifierGroups.modifierGroupId,
    })
    .from(menuItemModifierGroups)
    .where(
      and(
        eq(menuItemModifierGroups.restaurantId, restaurantId),
        inArray(menuItemModifierGroups.menuItemId, menuItemIds),
      ),
    );

  const groupIds = [...new Set(links.map((l) => l.groupId))];
  if (!groupIds.length) return scopesByItem;

  const groups = await db
    .select()
    .from(modifierGroups)
    .where(and(inArray(modifierGroups.id, groupIds), eq(modifierGroups.isActive, true)));
  const activeGroupIds = new Set(groups.map((g) => g.id));

  const options = await db
    .select()
    .from(modifierOptions)
    .where(
      and(
        inArray(modifierOptions.groupId, groupIds),
        eq(modifierOptions.restaurantId, restaurantId),
        eq(modifierOptions.available, true),
      ),
    );

  const optionsByGroup = new Map<number, Map<number, typeof modifierOptions.$inferSelect>>();
  for (const opt of options) {
    let map = optionsByGroup.get(opt.groupId);
    if (!map) {
      map = new Map();
      optionsByGroup.set(opt.groupId, map);
    }
    map.set(opt.id, opt);
  }

  for (const link of links) {
    if (!activeGroupIds.has(link.groupId)) continue;
    const group = groups.find((g) => g.id === link.groupId)!;
    const optionMap = optionsByGroup.get(link.groupId) ?? new Map();
    let list = scopesByItem.get(link.menuItemId);
    if (!list) {
      list = [];
      scopesByItem.set(link.menuItemId, list);
    }
    list.push({ group, options: optionMap });
  }
  return scopesByItem;
}

/**
 * Customer-facing modifier groups per menu item, as DTOs. Reuses the exact
 * resolution computeBill validates against, so what the dish sheet offers can
 * never drift from what checkout will accept. Groups with no available options
 * are dropped unless they are mandatory, and an item with nothing left to
 * offer is returned without any groups (the storefront then adds it directly).
 */
export async function getMenuModifierGroups(
  restaurantId: number,
  menuItemIds: number[],
): Promise<Map<number, ModifierGroupDto[]>> {
  const scopes = await loadModifierScopes(restaurantId, menuItemIds);
  const result = new Map<number, ModifierGroupDto[]>();
  for (const [menuItemId, list] of scopes) {
    const groups: ModifierGroupDto[] = [];
    for (const scope of list) {
      const options = [...scope.options.values()].map((opt) => ({
        id: opt.id,
        name: opt.name,
        priceCents: opt.priceCents,
        isVeg: opt.isVeg,
      }));
      if (!options.length && scope.group.minSelect === 0) continue;
      groups.push({
        id: scope.group.id,
        name: scope.group.name,
        minSelect: Math.max(0, scope.group.minSelect),
        maxSelect: Math.max(1, scope.group.maxSelect),
        options,
      });
    }
    if (groups.length) result.set(menuItemId, groups);
  }
  return result;
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<{ ok: true; order: OrderDto } | { ok: false; error: string; code?: string }> {
  const clientRequestId = String(input.clientRequestId ?? "").trim().slice(0, 80) || null;

  if (clientRequestId) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(eq(orders.clientRequestId, clientRequestId))
      .limit(1);
    if (existing) return { ok: true, order: toOrderDto(existing) };
  }

  const computed = await computeBill(input.restaurantSlug, input.items);
  if (!computed.ok) return { ok: false, error: computed.error };
  const { restaurant: r, lines, bill } = computed;

  // Phase 7 — validate the optional outlet claim against the integration
  // record BEFORE the order is created (fail-closed; no silent fallback).
  let claimedOutletId: string | null = null;
  if (input.outletId) {
    const outlet = await resolveOutletForRestaurant(r.id, input.outletId);
    if (!outlet.ok) {
      return { ok: false, error: OUTLET_ERROR_MESSAGES[outlet.code] ?? "Invalid outlet", code: outlet.code };
    }
    claimedOutletId = outlet.claimedOutletId;
  }

  const snapshot: OrderItemSnapshot[] = lines.map(({ menuItem: m, quantity, modifiers }) => ({
    menuItemId: m.id,
    name: m.name,
    priceCents: m.priceCents,
    quantity,
    imageUrl: m.imageUrl,
    isVeg: m.isVeg,
    modifiers: modifiers.length
      ? modifiers.map(({ option, quantity: optQty }) => ({
          optionId: option.id,
          name: option.name,
          priceCents: option.priceCents,
          quantity: optQty,
        }))
      : undefined,
  }));

  try {
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
        subtotalCents: bill.subtotalCents,
        deliveryFeeCents: bill.deliveryFeeCents,
        platformFeeCents: bill.platformFeeCents,
        discountCents: bill.discountCents,
        totalCents: bill.totalCents,
        clientRequestId,
        ...(claimedOutletId ? { outletId: claimedOutletId } : {}),
      })
      .returning();

    // Phase 4 — persist the stable external order id (mkt_ord_<id>) so the
    // POS status webhook resolver can find this order by (restaurant, external
    // order id). Derived from id but stored explicitly for unique lookup.
    if (created.externalOrderId == null) {
      await db
        .update(orders)
        .set({ externalOrderId: externalOrderIdFor(created.id) })
        .where(eq(orders.id, created.id));
    }

    return { ok: true, order: toOrderDto(created) };
  } catch (e) {
    // Concurrent retry with the same key: the unique constraint let one win;
    // return the surviving order so the caller sees a single result.
    if (clientRequestId && isUniqueViolation(e)) {
      const [existing] = await db
        .select()
        .from(orders)
        .where(eq(orders.clientRequestId, clientRequestId))
        .limit(1);
      if (existing) return { ok: true, order: toOrderDto(existing) };
    }
    throw e;
  }
}

/** Order lookup scoped to a restaurant owner (integration / own-store access). */
export async function getIntegrationOrderByCodeForRestaurant(
  code: string,
  restaurantId: number,
): Promise<OrderDto | null> {
  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.code, code.toUpperCase()), eq(orders.restaurantId, restaurantId)))
    .limit(1);
  return o ? toOrderDto(o) : null;
}

export async function getOrderByCode(code: string): Promise<OrderDto | null> {
  const [o] = await db.select().from(orders).where(eq(orders.code, code.toUpperCase())).limit(1);
  return o ? toOrderDto(o) : null;
}

export interface OrderCancelContext {
  restaurantId: number;
  code: string;
  externalOrderId: string | null;
  integrationStatus: string;
  posOrderId: number | null;
  marketplaceId: string | null;
  integrationActive: boolean;
  sealedSecret: string | null;
}

/**
 * Everything the customer-cancellation path needs to sign a cancel request to
 * the POS. The tenant (marketplace_id) is always the value derived from the
 * order's restaurant — never a client-supplied assertion.
 */
export async function loadOrderCancelContext(code: string): Promise<OrderCancelContext | null> {
  const [o] = await db
    .select({
      restaurantId: orders.restaurantId,
      code: orders.code,
      externalOrderId: orders.externalOrderId,
      integrationStatus: orders.integrationStatus,
      posOrderId: orders.posOrderId,
      marketplaceId: restaurants.marketplaceId,
      integrationRowStatus: integrationRecords.status,
      webhookSecret: integrationRecords.webhookSecret,
    })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .leftJoin(integrationRecords, eq(integrationRecords.restaurantId, orders.restaurantId))
    .where(eq(orders.code, code.toUpperCase()))
    .limit(1);
  if (!o) return null;
  return {
    restaurantId: o.restaurantId,
    code: o.code,
    externalOrderId: o.externalOrderId,
    integrationStatus: o.integrationStatus,
    posOrderId: o.posOrderId,
    marketplaceId: o.marketplaceId,
    integrationActive: o.integrationRowStatus === "active",
    sealedSecret: o.webhookSecret,
  };
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
