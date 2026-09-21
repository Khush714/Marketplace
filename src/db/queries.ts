import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  connectionCodes,
  connections,
  integrationSessions,
  menuItems,
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
  type BillBreakdown,
} from "@/lib/domain";
import { hashOwnerKey, hashToken, makeAccessToken, makeOwnerKey, ownerKeyMatches } from "@/lib/owner-key";
import type {
  ConnectionCodeDto,
  ConnectionDto,
  MenuItemDto,
  MenuSection,
  OrderDto,
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

/**
 * Resolve a cart against the real menu and compute the exact bill createOrder
 * will record. Single lookup + single pricing path shared with createOrder so
 * the amount shown at payment always matches the recorded order total.
 */
export async function computeBill(
  restaurantSlug: string,
  items: { menuItemId: number; quantity: number }[],
): Promise<
  | {
      ok: true;
      restaurant: typeof restaurants.$inferSelect;
      lines: { menuItem: typeof menuItems.$inferSelect; quantity: number }[];
      bill: BillBreakdown;
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

  const lines: { menuItem: typeof menuItems.$inferSelect; quantity: number }[] = [];
  let subtotal = 0;
  for (const item of items) {
    const m = byId.get(item.menuItemId);
    if (!m || m.restaurantId !== r.id) return { ok: false, error: "Invalid item in cart" };
    const qty = Math.min(20, Math.max(1, Math.floor(item.quantity) || 1));
    subtotal += m.priceCents * qty;
    lines.push({ menuItem: m, quantity: qty });
  }

  const bill = billFor(subtotal, r.offerPercent, r.offerMaxCents);
  return { ok: true, restaurant: r, lines, bill };
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<{ ok: true; order: OrderDto } | { ok: false; error: string }> {
  const computed = await computeBill(input.restaurantSlug, input.items);
  if (!computed.ok) return { ok: false, error: computed.error };
  const { restaurant: r, lines, bill } = computed;

  const snapshot: OrderItemSnapshot[] = lines.map(({ menuItem: m, quantity }) => ({
    menuItemId: m.id,
    name: m.name,
    priceCents: m.priceCents,
    quantity,
    imageUrl: m.imageUrl,
    isVeg: m.isVeg,
  }));

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
