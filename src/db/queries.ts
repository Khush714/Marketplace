import "server-only";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { externalOrderIdFor } from "@/db/pos-delivery";
import {
  connectionCodes,
  connections,
  customerSessions,
  integrationAudit,
  integrationRecords,
  integrationSessions,
  integrationTransferRequests,
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  orders,
  restaurantSessions,
  restaurants,
  type OrderItemSnapshot,
} from "@/db/schema";
import {
  billFor,
  CUISINES,
  DEFAULT_DISH_IMAGE,
  DEFAULT_LOCALITY,
  DEFAULT_RESTAURANT_HERO,
  DEFAULT_RESTAURANT_IMAGE,
  LOCALITIES,
  makeConnectionCode,
  makeOrderCode,
  orderProgress,
  ORDER_STAGES,
  sanitizeImageUrl,
  type BillBreakdown,
} from "@/lib/domain";
import { hashOwnerKey, hashToken, integrationPasskeyMatches, makeAccessToken, makeMarketplaceId, makeOwnerKey, ownerKeyMatches } from "@/lib/owner-key";
import {
  INTEGRATION_SESSION_TTL_MS,
  integrationSessionIsLive,
  nextIdleExpiry,
} from "@/lib/integration-session-core";
import { makeCsrfToken, makeSessionToken, RESTAURANT_SESSION_TTL_MS, DELETE_CONFIRM_TTL_MS } from "@/lib/restaurant-session-core";
import { CUSTOMER_SESSION_TTL_MS, makeCustomerSessionToken, normalizeOrderCodes } from "@/lib/customer-session-core";
import { hashTrackingToken, makeTrackingToken } from "@/lib/order-tracking";
import { ORDERING_CLOSED_MESSAGE, orderingGateEnforced } from "@/lib/ordering-gate";
import { discoverableRestaurant } from "@/lib/discoverability";
import { escapeLike, MAX_SLUGS } from "@/lib/abuse-core";
import { emitSecurityEvent } from "@/lib/security/security-events";
import { MAX_ITEM_QUANTITY } from "@/lib/order-input-core";
import {
  blocksRedemption,
  normalizeConnectionCode,
  toCodeStatus,
  UNREDEEMABLE_STATUS,
  UNSPENT_CODE,
  unspentCodeByCode,
} from "@/lib/connection-codes";
import { statusRank, TERMINAL_STATUSES } from "@/integrations/pos/order-status";
import {
  OPEN_ORDER_PREDICATE,
  planTransferApproval,
  shouldActivateOnApproval,
  type TransferDecision,
  type TransferStateSnapshot,
} from "@/lib/integration-transfer";
import { OUTLET_ERROR_MESSAGES, resolveOutletForRestaurant } from "@/integrations/pos/resolve-outlet";
import { canDeliverToPos, integrationReadiness } from "@/integrations/pos/readiness";
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

/*
 * Every DTO that carries an image re-applies `sanitizeImageUrl`, so a row
 * written before `lib/image-policy.ts` existed — or by a path that somehow
 * bypassed it — still cannot reach `next/image` with a host the optimizer
 * refuses. Read-through validation, not just write-time, is what keeps the
 * rendered catalogue and the fetch surface in agreement.
 */

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
    imageUrl: sanitizeImageUrl(r.imageUrl, DEFAULT_RESTAURANT_IMAGE),
    heroUrl: sanitizeImageUrl(r.heroUrl, DEFAULT_RESTAURANT_HERO),
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
    imageUrl: sanitizeImageUrl(m.imageUrl, DEFAULT_DISH_IMAGE),
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
  // `posConnected`, not `externalOrderId` — see the column comment. Only an
  // order admitted through a live POS integration is driven by POS events; a
  // seeded/demo order keeps the elapsed-time timeline it was always meant to
  // have, instead of sitting at "waiting for the restaurant to accept" forever
  // behind an ETA that resets on every poll.
  const integrated = o.posConnected;
  const status = integrated ? integrationOrderStatus(o) : demoOrderStatus(o);
  return {
    id: o.id,
    code: o.code,
    restaurantSlug: o.restaurantSlug,
    restaurantName: o.restaurantName,
    restaurantId: o.restaurantId,
    externalOrderId: o.externalOrderId,
    // Snapshots freeze the item at order time; re-sanitising on the way out
    // means an order placed while an image URL was still unvalidated cannot
    // surface a host the optimizer now refuses.
    items: (o.items as OrderItemSnapshot[]).map((it) => ({
      ...it,
      imageUrl: sanitizeImageUrl(it.imageUrl, DEFAULT_DISH_IMAGE),
    })),
    addressLabel: o.addressLabel,
    addressText: o.addressText,
    customerName: o.customerName,
    phone: o.phone,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    posDeliveryStatus: o.posDeliveryStatus,
    posConnected: integrated,
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

/**
 * Whether a restaurant can actually receive an order from the Marketplace.
 *
 * Single source of truth for "is this restaurant wired to a POS": the ordering
 * gate reads it at checkout, and `createOrder` records the answer on the order
 * so tracking keeps the right lifecycle even if the integration is later
 * disabled. `resolveOutletForRestaurant` is deliberately not reused here — it
 * also validates an outlet claim, which checkout has not got at this point.
 *
 * `status = 'active'` alone is NOT sufficient and treating it as such was a
 * money bug: the claim flow could set ACTIVE without a webhook secret (it only
 * seals one when the POS sends it), and `enqueueOrderDelivery` gates on this
 * same predicate but `attemptPosDelivery` additionally refuses to POST without
 * a secret. The result was an order the customer was charged for and the
 * journal retried forever with "webhook secret missing". So readiness is
 * asserted from all three facts delivery actually needs, matching
 * `notReadyReason` in the order bridge:
 *
 *   - an ACTIVE integration record
 *   - a POS restaurant id to route `order.restaurant_id` on
 *   - a sealed webhook secret to sign the payload with
 */
export async function hasActiveIntegration(restaurantId: number): Promise<boolean> {
  const [rec] = await db
    .select({
      status: integrationRecords.status,
      posRestaurantId: integrationRecords.posRestaurantId,
      webhookSecret: integrationRecords.webhookSecret,
    })
    .from(integrationRecords)
    .where(eq(integrationRecords.restaurantId, restaurantId))
    .limit(1);
  return canDeliverToPos(rec ?? {});
}

/**
 * The same rule as `hasActiveIntegration`, reported as a reason instead of a
 * boolean so the partner console can say *why* orders are blocked.
 *
 * This used to be a second, hand-rolled copy of the predicate sitting right
 * here. It now delegates to the shared helper, because the two silently
 * disagreeing is precisely the failure that shipped a hard-coded "ACTIVE" to a
 * restaurant whose orders could not be delivered.
 */

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
  const conditions: (SQL | undefined)[] = [discoverableRestaurant];
  if (filters.q) {
    // Escaped the same way `searchAll` escapes: `%`/`_` in a typed term are
    // literals, not pattern syntax, so a query of "%" does not match the whole
    // catalogue (and browse has no `.limit()` to absorb it).
    const like = `%${escapeLike(filters.q)}%`;
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
              // Explicit NULLS LAST: a listing with no measured distance has no
              // place in a "nearest" ranking, and Postgres only guarantees this
              // implicitly for ASC.
              ? [sql`${restaurants.distanceKm} asc nulls last`]
              : [desc(restaurants.featured), desc(restaurants.rating)];

  const rows = await db
    .select()
    .from(restaurants)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderBy);
  return rows.map(toRestaurantDto);
}

export async function featuredRestaurants(locality?: string): Promise<RestaurantDto[]> {
  const conditions = [discoverableRestaurant, eq(restaurants.featured, true)];
  if (locality) conditions.push(eq(restaurants.locality, locality));
  const rows = await db
    .select()
    .from(restaurants)
    .where(and(...conditions))
    .orderBy(desc(restaurants.rating));
  return rows.map(toRestaurantDto);
}

/**
 * Slug + creation date for every listing that may be indexed.
 *
 * Deliberately narrow: `browseRestaurants` hydrates the full DTO (menu sections,
 * modifier groups, image URLs) and `RestaurantDto` carries no timestamp at all,
 * but sitemap generation needs nothing beyond a slug and an honest
 * `lastModified`. Selecting the whole row here would make a crawl-triggered
 * query pay for data no consumer reads.
 *
 * Uses the same `discoverableRestaurant` predicate as browse and search, so the
 * sitemap can never advertise a listing the grid hides — in particular never an
 * empty-menu listing, whose page renders "Menu being prepared".
 */
export async function discoverableRestaurantSlugs(): Promise<{ slug: string; createdAt: Date }[]> {
  const rows = await db
    .select({ slug: restaurants.slug, createdAt: restaurants.createdAt })
    .from(restaurants)
    .where(discoverableRestaurant)
    .orderBy(desc(restaurants.createdAt));
  return rows;
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
  // The term becomes a LIKE pattern, so its wildcards have to be escaped or a
  // query of "%" matches every row and "_" matches any character — the pattern
  // stops meaning what the user typed. `.limit()` below still bounds the result
  // set; this bounds the pattern the planner has to work through.
  const like = `%${escapeLike(q)}%`;
  const restaurantCondition = and(
    discoverableRestaurant,
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
    ratingsCount: r.ratingsCount,
    deliveryMinutes: r.deliveryMinutes,
    imageUrl: sanitizeImageUrl(r.imageUrl, DEFAULT_RESTAURANT_IMAGE),
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
    imageUrl: sanitizeImageUrl(d.imageUrl, DEFAULT_DISH_IMAGE),
    restaurantSlug: d.restaurantSlug,
    restaurantName: d.restaurantName,
  }));

  return [...restResults, ...dishResults];
}

export async function restaurantsBySlugs(slugs: string[]): Promise<RestaurantDto[]> {
  // Capped here rather than only at the route: this array is spliced straight
  // into `inArray(...)`, so the statement grows with the caller's input. The
  // route clamps it too, but a query helper that is safe by construction is the
  // cheaper thing to rely on than every call site remembering to clamp.
  const bounded = slugs.slice(0, MAX_SLUGS);
  if (!bounded.length) return [];
  const rows = await db
    .select()
    .from(restaurants)
    .where(and(eq(restaurants.isActive, true), inArray(restaurants.slug, bounded)));
  return rows.map(toRestaurantDto);
}

/* --------------------------- connection codes ---------------------------- */

/**
 * The three states a connection code can be in.
 *
 * Kept as a set rather than a `status === "used" ? … : "unused"` ternary because
 * revocation added a third state, and a mapper that folds it into "unused" is
 * exactly the bug that would make a revoked invite look redeemable — both in the
 * ops console and, worse, in the redemption pre-check below. The mapping itself
 * lives in lib/connection-codes.ts so it can be asserted in isolation.
 */
function toConnectionCodeDto(
  c: typeof connectionCodes.$inferSelect,
  restaurantId: number | null = null,
  restaurantName: string | null = null,
): ConnectionCodeDto {
  return {
    id: c.id,
    code: c.code,
    status: toCodeStatus(c.status),
    restaurantId,
    restaurantName,
    createdAt: new Date(c.createdAt).toISOString(),
    usedAt: c.usedAt ? new Date(c.usedAt).toISOString() : null,
    expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
    revokedAt: c.revokedAt ? new Date(c.revokedAt).toISOString() : null,
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
    .where(eq(connectionCodes.code, normalizeConnectionCode(code)))
    .limit(1);
  return row
    ? toConnectionCodeDto(row.c, row.restaurantId ?? null, row.restaurantName ?? null)
    : null;
}

export type RevokeConnectionCodeResult =
  | { ok: true; code: ConnectionCodeDto }
  | { ok: false; error: string; reason: "not_found" | "already_used" };

/**
 * Operator withdrawal of an unused onboarding code — the one way to kill an
 * invite that was minted in good faith and then leaked, emailed to the wrong
 * address, or issued twice to the same restaurant.
 *
 * Three properties are load-bearing:
 *
 *   - **Unused only.** The `status = 'unused'` predicate in the UPDATE is the
 *     whole security property. A code that already produced a listing cannot be
 *     returned to circulation, because redeeming it a second time would create a
 *     duplicate live listing for one invitation. Revoking a spent code is
 *     refused rather than silently ignored, so the operator learns the code they
 *     are looking at is not the thing they think it is.
 *   - **Atomic.** The predicate lives in the UPDATE rather than in a preceding
 *     SELECT, so two operators revoking at once cannot both read "unused" and
 *     both write. Same pattern as the redemption spend.
 *   - **A flag, not a delete.** The row survives so `listConnectionCodes` can
 *     still show that code was issued and withdrawn. Deleting it would also
 *     break the `connections.code_id` foreign key for any code that had been
 *     redeemed, which is the already_used case.
 */
export async function revokeConnectionCode(code: string): Promise<RevokeConnectionCodeResult> {
  const normalized = normalizeConnectionCode(code);
  if (!normalized) return { ok: false, error: "Enter a connection code", reason: "not_found" };

  const [revoked] = await db
    .update(connectionCodes)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(unspentCodeByCode(normalized))
    .returning();

  if (revoked) return { ok: true, code: toConnectionCodeDto(revoked) };

  // Nothing came back. Distinguish "no such code" from "already spent", but
  // only after confirming the row exists so a typo is not reported as a
  // redemption that already happened.
  const [existing] = await db
    .select()
    .from(connectionCodes)
    .where(eq(connectionCodes.code, normalized))
    .limit(1);
  if (!existing) return { ok: false, error: "Connection code not found", reason: "not_found" };
  return {
    ok: false,
    error:
      existing.status === "used"
        ? "That code was already redeemed, so it cannot be revoked"
        : "That code is already revoked",
    reason: "already_used",
  };
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

/** The listing fields a restaurant supplies about itself, minus how it got here. */
export interface ListingProfileInput {
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

/** The transaction handle `db.transaction` hands its callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface NormalizedListing {
  name: string;
  tagline: string;
  cuisines: string[];
  locality: string;
  externalId: string;
  imageUrl: string;
  heroUrl: string;
}

/**
 * Validate and clamp the listing fields shared by code redemption and
 * self-signup, so the two onboarding paths cannot drift apart.
 */
function normalizeListingInput(
  input: ListingProfileInput,
): { ok: true; fields: NormalizedListing } | { ok: false; error: string } {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Restaurant name is required" };

  const externalId = String(input.externalId ?? "").trim().slice(0, 64);
  if (!externalId) return { ok: false, error: "Marketplace store ID is required" };

  // Cuisines are validated against the marketplace vocabulary rather than
  // stored verbatim: the browse filter rail is a fixed list and matches with
  // `= any(cuisines)`, so an off-list tag makes a listing unfindable by cuisine.
  const normalizedCuisines = normalizeCuisines(input.cuisines);
  if (!normalizedCuisines.ok) return { ok: false, error: normalizedCuisines.error };

  const locality = LOCALITIES.some((l) => l.name === input.locality) ? input.locality : DEFAULT_LOCALITY.name;

  return {
    ok: true,
    fields: {
      name,
      tagline: String(input.tagline ?? "").trim().slice(0, 80),
      cuisines: normalizedCuisines.cuisines,
      locality,
      externalId,
      // Sanitised the same way partner-authored dish images are: an
      // unvalidated restaurant image URL feeds next/image directly.
      imageUrl: sanitizeImageUrl(input.imageUrl, DEFAULT_RESTAURANT_IMAGE),
      heroUrl: sanitizeImageUrl(input.heroUrl, DEFAULT_RESTAURANT_HERO),
    },
  };
}

/**
 * Insert a listing row. Caller owns the transaction and any uniqueness
 * pre-checks; `isActive` is the one behavioural switch between the two paths.
 */
async function insertListing(
  tx: Tx,
  fields: NormalizedListing,
  ownerKeyHash: string,
  opts: { isActive: boolean },
): Promise<typeof restaurants.$inferSelect> {
  const slugExists = async (candidate: string) =>
    (
      await tx
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.slug, candidate))
        .limit(1)
    ).length > 0;
  const slug = await uniqueRestaurantSlug(slugExists, slugify(fields.name));

  const [r] = await tx
    .insert(restaurants)
    .values({
      slug,
      name: fields.name,
      tagline: fields.tagline,
      cuisines: fields.cuisines,
      locality: fields.locality,
      externalId: fields.externalId,
      marketplaceId: makeMarketplaceId(),
      ownerKeyHash,
      // The one-time key the restaurant is shown doubles as its initial POS
      // passkey, so both credentials start identical and only diverge on
      // rotation.
      integrationPasskeyHash: ownerKeyHash,
      isActive: opts.isActive,
      imageUrl: fields.imageUrl,
      heroUrl: fields.heroUrl,
      // A newly connected listing has no reviews. The schema default of
      // 4.2/1000 exists so seeded rows sort, but inheriting it here would
      // put invented social proof in front of customers. Customer surfaces
      // render "New" while ratingsCount is 0 (see isUnrated).
      rating: 0,
      ratingsCount: 0,
    })
    .returning();

  return r;
}

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
  const code = normalizeConnectionCode(input.code);
  if (!code) return { ok: false, error: "Enter the connection code" };

  const normalized = normalizeListingInput(input);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const fields = normalized.fields;

  const [c] = await db
    .select()
    .from(connectionCodes)
    .where(eq(connectionCodes.code, code))
    .limit(1);
  if (!c) return { ok: false, error: "Connection code not found" };
  // Pre-check picks the *message* only. Authorisation is the conditional
  // UPDATE below, which is the same UNSPENT_CODE fragment the revoke path uses.
  if (blocksRedemption(c.status)) {
    return { ok: false, error: UNREDEEMABLE_STATUS[toCodeStatus(c.status)] };
  }
  if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { ok: false, error: "Connection code has expired" };

  const ownerKey = makeOwnerKey();
  const ownerKeyHash = hashOwnerKey(ownerKey);

  try {
    const restaurant = await db.transaction(async (tx) => {
      // Atomic spend — only one concurrent redeemer can flip the code. Shared
      // with revokeConnectionCode on purpose: a code that is either spent or
      // withdrawn must be unusable, and one predicate cannot drift from the other.
      const [spent] = await tx
        .update(connectionCodes)
        .set({ status: "used", usedAt: new Date() })
        .where(and(eq(connectionCodes.id, c.id), UNSPENT_CODE))
        .returning({ id: connectionCodes.id });
      if (!spent) throw new CodeAlreadyUsedError();

      const [existing] = await tx
        .select()
        .from(restaurants)
        .where(eq(restaurants.externalId, fields.externalId))
        .limit(1);
      if (existing) throw new ExternalIdTakenError();

      // An ops-minted code is an explicit invite, so the listing goes live.
      const r = await insertListing(tx, fields, ownerKeyHash, { isActive: true });
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

/**
 * Onboard a restaurant with no ops-minted code.
 *
 * This is the self-serve path, and it deliberately does NOT hand the caller a
 * live listing. `is_active` starts false for three reasons:
 *
 *   1. Discoverability already requires `is_active` AND a published menu item,
 *      so an unvetted listing stays out of browse and out of search entirely.
 *   2. Ordering is separately gated on `hasActiveIntegration`, so nothing can
 *      be charged or dispatched until a POS is actually claimed — the POS
 *      connection code is the real proof of ownership, and it is still
 *      required on /partner/integrations.
 *   3. It makes junk listings self-limiting: each one is inert until a human
 *      behind that POS deliberately connects it and publishes a menu.
 *
 * The restaurant activates its own listing from /partner once connected, so
 * there is still no ops step anywhere in the funnel.
 */
export async function selfRegisterRestaurant(
  input: ListingProfileInput,
): Promise<
  | { ok: true; restaurant: RestaurantDto; ownerKey: string }
  | { ok: false; error: string; code?: "STORE_ID_TAKEN" }
> {
  const normalized = normalizeListingInput(input);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const fields = normalized.fields;

  const ownerKey = makeOwnerKey();
  const ownerKeyHash = hashOwnerKey(ownerKey);

  try {
    const restaurant = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.externalId, fields.externalId))
        .limit(1);
      if (existing) throw new ExternalIdTakenError();

      return insertListing(tx, fields, ownerKeyHash, { isActive: false });
    });

    return { ok: true, restaurant: toRestaurantDto(restaurant), ownerKey };
  } catch (e) {
    if (e instanceof ExternalIdTakenError || isUniqueViolation(e)) {
      return {
        ok: false,
        error: "This store ID is already connected to another restaurant",
        code: "STORE_ID_TAKEN",
      };
    }
    throw e;
  }
}

/** Restaurant-side handshake: present the owner key to prove control of a listing. */
export async function verifyOwner(ownerKey: string): Promise<RestaurantDto | null> {
  const id = await restaurantIdForOwnerKey(ownerKey);
  if (id === null) return null;
  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  return r ? toRestaurantDto(r) : null;
}

/**
 * The listing id an owner key controls, or null.
 *
 * The single place the owner key is turned into an identity. Everything that used
 * to re-implement "hash the key, find the row" now goes through here and works
 * from the id, so there is exactly one lookup to reason about and exactly one
 * place that has to stay correct.
 */
async function restaurantIdForOwnerKey(ownerKey: string): Promise<number | null> {
  const key = String(ownerKey ?? "").trim();
  if (!key) return null;
  const [row] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.ownerKeyHash, hashOwnerKey(key)))
    .limit(1);
  return row?.id ?? null;
}

function toRestaurantManageDto(r: typeof restaurants.$inferSelect): RestaurantManageDto {
  return { ...toRestaurantDto(r), isActive: r.isActive };
}

/**
 * Full listing (plus live state) for an authenticated owner.
 *
 * Takes the id, not the key. Under the old scheme this was `…ByOwnerKey`, and the
 * difference is the whole point of the session work: the identity is now resolved
 * once from a revocable, expiring credential and carried as a plain integer,
 * rather than re-derived from a long-lived secret on every single request.
 */
export async function getRestaurantManageById(restaurantId: number): Promise<RestaurantManageDto | null> {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  return r ? toRestaurantManageDto(r) : null;
}

/** Full listing (plus live state) for the owner who holds the key. */
export async function getRestaurantByOwnerKey(ownerKey: string): Promise<RestaurantManageDto | null> {
  const id = await restaurantIdForOwnerKey(ownerKey);
  if (id === null) return null;
  return getRestaurantManageById(id);
}

/** Pause (isActive=false) or resume (isActive=true) an authenticated owner's listing. */
export async function setRestaurantActiveById(
  restaurantId: number,
  active: boolean,
): Promise<
  { ok: true; restaurant: RestaurantManageDto } | { ok: false; error: string }
> {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r) return { ok: false, error: "Restaurant not found" };
  const next = Boolean(active);
  if (r.isActive !== next) {
    await db.update(restaurants).set({ isActive: next }).where(eq(restaurants.id, r.id));
  }
  return { ok: true, restaurant: toRestaurantManageDto({ ...r, isActive: next }) };
}

/**
 * Normalise a free-text cuisine list onto the marketplace's published
 * vocabulary, case- and whitespace-insensitively.
 *
 * Onboarding and the profile editor both accept free text, but the browse
 * filter rail is a fixed 12-chip list (`CUISINES` in lib/domain.ts) and the
 * filter query is an exact `= any(cuisines)` match. A listing tagged
 * "kashmiri" or "Biryani " is therefore stored fine and then unfindable by
 * cuisine — so unknown values are rejected here, with the valid set in the
 * error, rather than silently creating an orphan tag.
 */
export function normalizeCuisines(
  raw: unknown,
): { ok: true; cuisines: string[] } | { ok: false; error: string } {
  const input = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const byKey = new Map(CUISINES.map((c) => [c.toLowerCase(), c]));

  const cuisines: string[] = [];
  const unknown: string[] = [];
  for (const entry of input) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) continue;
    const canonical = byKey.get(trimmed.toLowerCase());
    if (canonical) {
      if (!cuisines.includes(canonical)) cuisines.push(canonical);
    } else if (!unknown.includes(trimmed)) {
      unknown.push(trimmed);
    }
  }

  if (unknown.length) {
    return {
      ok: false,
      error: `Unknown cuisine${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Choose from: ${CUISINES.join(", ")}`,
    };
  }
  if (!cuisines.length) return { ok: false, error: "At least one cuisine is required" };
  return { ok: true, cuisines: cuisines.slice(0, 4) };
}

export interface RestaurantProfileInput {
  name: string;
  tagline: string;
  cuisines: string[];
  locality: string;
  imageUrl?: string;
  heroUrl?: string;
  pureVeg?: boolean;
}

/**
 * Edit the parts of a listing a partner owns.
 *
 * Onboarding is otherwise write-once: nothing in the partner surface can fix a
 * mistyped name, a wrong locality or a tag that is not on the filter rail, and
 * the only escape was deleting the listing and redeeming a new code.
 *
 * The tenant is resolved from the caller's session and NEVER taken from the
 * request body — the same rule the menu editor follows (see db/partner-menu.ts).
 * Ids that are not partner-editable (slug, rating, distanceKm, featured, offer,
 * externalId, marketplaceId) are deliberately absent from the patch set.
 *
 * `slug` is intentionally NOT regenerated: it is already in shared links and
 * order history, so a rename leaves the old address working.
 */
export async function updateRestaurantProfileById(
  restaurantId: number,
  input: RestaurantProfileInput,
): Promise<{ ok: true; restaurant: RestaurantManageDto } | { ok: false; error: string }> {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r) return { ok: false, error: "Restaurant not found" };

  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Restaurant name is required" };

  const normalized = normalizeCuisines(input.cuisines);
  if (!normalized.ok) return normalized;

  // A locality outside the served set would hide the listing from every
  // browse query, so reject it loudly instead of silently filing it under the
  // default locality the way redemption used to.
  const locality = String(input.locality ?? "").trim();
  if (!LOCALITIES.some((l) => l.name === locality)) {
    return { ok: false, error: `Choose a served locality: ${LOCALITIES.map((l) => l.name).join(", ")}` };
  }

  const tagline = String(input.tagline ?? "").trim().slice(0, 80);
  // Fall back to the CURRENT image only when it is itself still valid; a value
  // from before the allowlist existed is healed to the shared default rather
  // than kept alive by a no-op profile save.
  const imageUrl = sanitizeImageUrl(input.imageUrl, sanitizeImageUrl(r.imageUrl, DEFAULT_RESTAURANT_IMAGE));
  const heroUrl = sanitizeImageUrl(input.heroUrl, sanitizeImageUrl(r.heroUrl, DEFAULT_RESTAURANT_HERO));
  const pureVeg = Boolean(input.pureVeg);

  const [updated] = await db
    .update(restaurants)
    .set({ name, tagline, cuisines: normalized.cuisines, locality, imageUrl, heroUrl, pureVeg })
    .where(eq(restaurants.id, r.id))
    .returning();
  return { ok: true, restaurant: toRestaurantManageDto(updated) };
}

/**
 * Permanently remove an owner's listing together with its menu, connection,
 * integration sessions and order history. Requires the exact restaurant name
 * as an explicit, typed confirmation.
 *
 * Note what this function is NOT responsible for. By the time it is called the
 * caller has already proven a live session, a matching CSRF token, a fresh
 * single-use delete confirmation, and the typed name — the route owns that stack,
 * because each of those is a credential check and this is a data operation. What
 * it does own is the last line of defence on the tenant: the id comes from the
 * resolved session, never from the request, so a caller cannot widen the blast
 * radius by naming a different restaurant.
 *
 * `restaurant_sessions` rows are not listed in the cascade below because they do
 * not need to be: the column is `ON DELETE CASCADE`, so the last statement takes
 * this listing's sessions with it. Listing them explicitly would be redundant
 * today and a silent no-op if someone ever changed that.
 */
export async function deleteRestaurantById(
  restaurantId: number,
  confirmName: string,
): Promise<{ ok: true; restaurantName: string } | { ok: false; error: string }> {
  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r) return { ok: false, error: "Restaurant not found" };
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

/* --------------------------- partner sessions ----------------------------- */

/**
 * A live partner session, as the auth layer needs it.
 *
 * `csrfHash` and the delete-confirmation columns are carried on the same row as
 * the session token on purpose: every one of them is only meaningful in
 * combination with a valid session, so resolving them together is one query
 * instead of three and there is no window in which a session is accepted but its
 * CSRF secret has not been loaded.
 */
export interface RestaurantSession {
  id: number;
  restaurantId: number;
  csrfHash: string;
  deleteConfirmHash: string | null;
  deleteConfirmExpiresAt: Date | null;
  expiresAt: Date;
  /**
   * Carried because it is a liveness input, not bookkeeping. Omitting it here
   * made `revokeRestaurantSession` a no-op as far as authentication was
   * concerned: `sessionIsLive` reads `revokedAt`, an absent field arrives as
   * `undefined`, and `undefined` is falsy — so "sign out", and the key rotation
   * that revokes every session, left the stolen credential working for its
   * remaining 30 days. Revocation only counts if the revoked row says so.
   */
  revokedAt: Date | null;
}

/**
 * Exchange a proven owner key for a fresh session.
 *
 * This is the single point where the long-lived recovery credential becomes a
 * short-lived working credential, and it is deliberately the only one. Every
 * other partner route resolves the restaurant from the returned session, so a
 * leaked owner key costs an attacker one 30-day session rather than permanent
 * access — and because the owner key is never transmitted again, it stops
 * appearing in request logs, proxy logs and browser history the moment the
 * restaurant upgrades.
 *
 * `csrfToken` is returned rather than derived from the session token so the
 * browser can hold it in memory while the session token stays HttpOnly and
 * unreachable from script. That asymmetry is the point: an XSS that runs on the
 * page cannot read the credential, only spend it while the user is looking.
 */
export async function createRestaurantSession(restaurantId: number): Promise<{
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}> {
  const sessionToken = makeSessionToken();
  const csrfToken = makeCsrfToken();
  const expiresAt = new Date(Date.now() + RESTAURANT_SESSION_TTL_MS);
  await db.insert(restaurantSessions).values({
    tokenHash: hashToken(sessionToken),
    restaurantId,
    csrfHash: hashToken(csrfToken),
    expiresAt,
  });
  // Phase 12: emitted here rather than at each caller so every mint path —
  // owner-key login, signup, post-redemption — is covered by construction.
  // Neither token crosses into the event; the restaurant id is all monitoring
  // needs to join this line to the audit trail.
  emitSecurityEvent("restaurant_session_created", { restaurantId, outcome: "success" });
  return { sessionToken, csrfToken, expiresAt };
}

/**
 * Resolve a session token to the session it names, or null.
 *
 * Returns the row even when it is expired or revoked; the caller decides what to
 * do with it (see `sessionIsLive`). Collapsing "not found" and "expired" into
 * null here would make a revoked session indistinguishable from a typo, which is
 * the wrong thing to surface — the console needs to be able to tell a partner
 * "sign in again" without also telling an attacker which of their guesses landed.
 */
export async function getRestaurantSession(token: string): Promise<RestaurantSession | null> {
  const t = String(token ?? "").trim();
  if (!t) return null;
  const [row] = await db
    .select()
    .from(restaurantSessions)
    .where(eq(restaurantSessions.tokenHash, hashToken(t)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    csrfHash: row.csrfHash,
    deleteConfirmHash: row.deleteConfirmHash,
    deleteConfirmExpiresAt: row.deleteConfirmExpiresAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Record that a session was just used.
 *
 * Best-effort by construction: it is awaited on the request path but nothing
 * branches on the result, because failing to write an audit timestamp must never
 * be the reason a restaurant cannot load its menu. Kept out of
 * `getRestaurantSession` so the read stays a single statement, and fired rather
 * than inlined so a caller can forget it without losing correctness.
 */
export async function touchRestaurantSession(sessionId: number): Promise<void> {
  await db
    .update(restaurantSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(restaurantSessions.id, sessionId));
}

/**
 * End one session now.
 *
 * This is the operation the owner key could not express. Rotating the key signs
 * the restaurant out of its own console with no way back in; revoking a session
 * signs out a device that is presumed lost and leaves the key valid for signing
 * back in from another one.
 */
export async function revokeRestaurantSession(sessionId: number): Promise<void> {
  await db
    .update(restaurantSessions)
    .set({ revokedAt: new Date() })
    .where(eq(restaurantSessions.id, sessionId));
  // Phase 12: the session id — never the token being revoked. Covers logout
  // and any future caller that ends a single device.
  emitSecurityEvent("restaurant_session_revoked", { sessionId, outcome: "success" });
}

/**
 * End every session for a restaurant.
 *
 * Called when the owner key rotates. That has to happen: rotation exists to
 * invalidate a credential someone else may hold, and a session minted from the
 * old key would otherwise stay valid for its full 30 days and hand that someone
 * exactly the access the rotation was performed to revoke. Sessions are revoked
 * rather than deleted so `last_used_at` still says when each device was last seen
 * — the useful half of the forensic record.
 */
export async function revokeRestaurantSessionsForRestaurant(restaurantId: number): Promise<void> {
  await db
    .update(restaurantSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(restaurantSessions.restaurantId, restaurantId), isNull(restaurantSessions.revokedAt)));
  // Phase 12: one line for the whole sweep (owner-key rotation, passkey
  // rotation) — `allSessions` distinguishes it from a single-device logout.
  emitSecurityEvent("restaurant_session_revoked", {
    restaurantId,
    allSessions: true,
    outcome: "success",
  });
}

/**
 * Mint a single-use confirmation for the one irreversible action in the console.
 *
 * Why a server-minted token at all, when the typed restaurant name already exists:
 * the name is not a secret. It is the public listing name — it is in the page
 * title, in search results, and in the URL of the restaurant's own page — so
 * anyone who has the session token (a stale cookie, a shared machine, an XSS that
 * has not yet been caught) can read the exact string the confirmation demands.
 * Typing it proves attention, not authorisation.
 *
 * What this adds is a value the attacker cannot derive: it is only ever held by
 * the browser that just asked for it, it is bound to one session, and it is spent
 * on the first delete attempt whether or not that attempt succeeded. Ten minutes is
 * long enough to read a dialog and type a name.
 *
 * Issued on demand rather than at sign-in because a confirmation minted eagerly
 * would sit valid in the database for the life of the session, which is a longer
 * window than the operation it authorises warrants.
 */
export async function issueDeleteConfirmation(sessionId: number): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + DELETE_CONFIRM_TTL_MS);
  // Overwrites any previous confirmation for this session, so "request the
  // token" always invalidates the last one rather than accumulating live
  // equivalents.
  await db
    .update(restaurantSessions)
    .set({ deleteConfirmHash: hashToken(token), deleteConfirmExpiresAt: expiresAt })
    .where(eq(restaurantSessions.id, sessionId));
  return { token, expiresAt };
}

/**
 * Spend a delete confirmation.
 *
 * The clear is conditional on the hash still matching, which is what makes this
 * single-use under concurrency rather than merely in the happy path: two
 * simultaneous deletes both holding the same valid token race on the same UPDATE,
 * the loser matches zero rows, and gets the "expired" answer instead of deleting
 * a second time. Clearing unconditionally would let a replayed token work twice,
 * and clearing nothing would leave a spent token live until it timed out.
 *
 * Expiry is part of the match, not a separate check: a confirmation older than
 * its ten-minute lifetime is indistinguishable from one that was never issued,
 * so it spends nothing and reports the same "refused" answer.
 */
export async function consumeDeleteConfirmation(sessionId: number, token: string): Promise<boolean> {
  const presented = String(token ?? "").trim();
  if (!presented) return false;
  const [row] = await db
    .update(restaurantSessions)
    .set({ deleteConfirmHash: null, deleteConfirmExpiresAt: null })
    .where(
      and(
        eq(restaurantSessions.id, sessionId),
        eq(restaurantSessions.deleteConfirmHash, hashToken(presented)),
        gt(restaurantSessions.deleteConfirmExpiresAt, new Date()),
      ),
    )
    .returning({ id: restaurantSessions.id });
  // Destructured, not measured: `row` is the first returned row or `undefined`,
  // so a matched update is "a row came back" rather than "an array has length".
  return row !== undefined;
}

/** Delete sessions that expired more than a day ago. */
export async function purgeExpiredRestaurantSessions(now: number = Date.now()): Promise<void> {
  await db
    .delete(restaurantSessions)
    .where(lt(restaurantSessions.expiresAt, new Date(now - 24 * 60 * 60 * 1000)));
}

/* --------------------------- customer sessions --------------------------- */

/**
 * A customer session, as the order routes need it.
 *
 * Deliberately carries `orderCodes` alongside the liveness fields: every
 * authorized request answers "is this session live?" and "does it hold this
 * code?" together, so one read answers both rather than two queries racing a
 * concurrent attach.
 */
export interface CustomerSession {
  id: number;
  orderCodes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Mint an anonymous session for this browser.
 *
 * Created empty and populated by `bindOrderCodesToSession`, so one code path
 * owns binding whether the session is being born from a checkout or renewed
 * from a boot-time flush. No security event is emitted: the event vocabulary
 * is a fixed set, and a customer placing an order is the app's normal path,
 * not an auditable anomaly — the row's own `last_used_at`/`created_at` carry
 * what monitoring needs.
 */
export async function createCustomerSession(): Promise<{ id: number; sessionToken: string; expiresAt: Date }> {
  const sessionToken = makeCustomerSessionToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);
  const [row] = await db
    .insert(customerSessions)
    .values({
      tokenHash: hashToken(sessionToken),
      orderCodes: [],
      expiresAt,
    })
    .returning({ id: customerSessions.id });
  return { id: row.id, sessionToken, expiresAt };
}

/**
 * Resolve a session token to the session it names, or null.
 *
 * Returns the row even when expired or revoked — the caller decides via
 * `customerSessionIsLive`, for the same reason `getRestaurantSession` does:
 * collapsing "not found" and "expired" would make a revoked session
 * indistinguishable from a typo to anyone watching response shapes.
 */
export async function getCustomerSession(token: string): Promise<CustomerSession | null> {
  const t = String(token ?? "").trim();
  if (!t) return null;
  const [row] = await db
    .select()
    .from(customerSessions)
    .where(eq(customerSessions.tokenHash, hashToken(t)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    orderCodes: Array.isArray(row.orderCodes) ? row.orderCodes : [],
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Record that a session was just used.
 *
 * Best-effort by construction, mirroring `touchRestaurantSession`: nothing
 * branches on the result, because failing to write an audit timestamp must
 * never be the reason a customer cannot read their order history.
 */
export async function touchCustomerSession(sessionId: number): Promise<void> {
  await db
    .update(customerSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(customerSessions.id, sessionId));
}

/**
 * Push a session's expiry a full TTL out, on an attach that also rewrites the
 * cookie.
 *
 * Renewal lives here rather than on every read on purpose: the cookie's
 * `Max-Age` is only refreshed by responses that set it, so extending the row
 * on a read would leave the browser holding a cookie that dies before the row
 * it names. Attaches (checkouts, boot-time claim flushes) are the one place
 * both are rewritten together, which is what keeps the two windows in step.
 */
export async function renewCustomerSession(sessionId: number): Promise<Date> {
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);
  await db
    .update(customerSessions)
    .set({ expiresAt, lastUsedAt: new Date() })
    .where(eq(customerSessions.id, sessionId));
  return expiresAt;
}

/**
 * Bind verified order codes to a session — newest first, deduplicated, capped.
 *
 * Read-modify-write under `SELECT ... FOR UPDATE`, not a blind jsonb append:
 * two attaches racing (a checkout flush and a boot-time flush for the same
 * browser) would otherwise each compute their own array and the loser's codes
 * would vanish silently — and a customer whose order fell out of the bound
 * list sees their own history as empty, which reads as data loss. The lock
 * serialises them; `normalizeOrderCodes` on the merged array is what makes the
 * second writer's append idempotent.
 */
export async function bindOrderCodesToSession(sessionId: number, codes: string[]): Promise<void> {
  const clean = normalizeOrderCodes(codes);
  if (!clean.length) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ orderCodes: customerSessions.orderCodes })
      .from(customerSessions)
      .where(eq(customerSessions.id, sessionId))
      .for("update");
    if (!row) return;
    const existing = Array.isArray(row.orderCodes) ? row.orderCodes : [];
    await tx
      .update(customerSessions)
      .set({ orderCodes: normalizeOrderCodes([...clean, ...existing]), lastUsedAt: new Date() })
      .where(eq(customerSessions.id, sessionId));
  });
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
 *
 * The password half is checked against `integration_passkey_hash`, falling back
 * to `owner_key_hash` for listings that predate the split — see
 * `integrationPasskeyMatches`.
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
  if (!integrationPasskeyMatches(row.r, p)) return null;
  return { restaurant: toRestaurantDto(row.r), codeId: row.c.id };
}

export async function createIntegrationSession(
  identity: IntegrationIdentity,
  meta?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAtIso: string; idleExpiresAtIso: string }> {
  const token = makeAccessToken();
  const now = new Date();
  const expires = new Date(now.getTime() + INTEGRATION_SESSION_TTL_MS);
  // A session's two clocks start here and their policy lives in
  // `integration-session-core.ts`: the absolute ceiling above, and a sliding
  // idle window below that every authenticated request pushes back out.
  const idleAt = nextIdleExpiry(now.getTime());
  await db.insert(integrationSessions).values({
    tokenHash: hashToken(token),
    restaurantId: identity.restaurant.id,
    codeId: identity.codeId,
    expiresAt: expires,
    idleExpiresAt: idleAt,
    lastUsedAt: now,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
  });
  return { token, expiresAtIso: expires.toISOString(), idleExpiresAtIso: idleAt.toISOString() };
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
  // The liveness policy is shared with the tests: revoked, absolute ceiling and
  // idle window are all decided here, not scattered across the query.
  if (
    !integrationSessionIsLive({
      expiresAt: row.s.expiresAt,
      idleExpiresAt: row.s.idleExpiresAt,
      revokedAt: row.s.revokedAt,
    })
  ) {
    return null;
  }
  const now = new Date();
  // One write per authenticated request: prove the session is being used and
  // slide its idle window in the same statement as the lastUsedAt touch.
  await db
    .update(integrationSessions)
    .set({ lastUsedAt: now, idleExpiresAt: nextIdleExpiry(now.getTime()) })
    .where(eq(integrationSessions.id, row.s.id));
  return toRestaurantDto(row.r);
}

/**
 * End exactly one session — the one that presented the given token — without
 * touching the restaurant's other POS terminals. The inverse of
 * `revokeIntegrationSessions`, which is the "sign out everywhere" fire-drill.
 */
export async function logoutIntegrationSession(token: string): Promise<boolean> {
  const t = String(token ?? "").trim();
  if (!t) return false;
  const [row] = await db
    .update(integrationSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(integrationSessions.tokenHash, hashToken(t)), isNull(integrationSessions.revokedAt)))
    .returning({ id: integrationSessions.id });
  return !!row;
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

/** Raised when a POS-supplied external id is already spoken for by another listing. */
export class MarketplaceIdTakenError extends Error {
  readonly ownedByRestaurantId: number;
  constructor(ownedByRestaurantId: number) {
    super(`marketplace id is already assigned to restaurant ${ownedByRestaurantId}`);
    this.name = "MarketplaceIdTakenError";
    this.ownedByRestaurantId = ownedByRestaurantId;
  }
}

/**
 * Reconcile the shared external identity once a POS claims the connection: the
 * Marketplace restaurant's marketplace_id (rst_…) and the POS's own
 * external_restaurant_id must be THE SAME value — order payloads route on it
 * (`order.restaurant_id`) and webhook receivers verify X-Integration-ID
 * against it. Returns the reconciled id.
 *
 * `marketplace_id` is UNIQUE, so a POS id that some other listing already holds
 * is a real conflict rather than a lost update. It is detected up front and
 * raised as `MarketplaceIdTakenError` instead of letting Postgres throw 23505 on
 * the UPDATE: the claim route calls this immediately AFTER the POS has consumed
 * the connection code, so a bare unique violation there surfaced as a generic
 * 500 and left the operator with a burned code and no way to retry.
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
  const [owner] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(eq(restaurants.marketplaceId, id), ne(restaurants.id, restaurantId)))
    .limit(1);
  if (owner) throw new MarketplaceIdTakenError(owner.id);
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
  /**
   * The three facts `attemptPosDelivery` actually needs, evaluated server-side.
   *
   * `status === "active"` alone is not the truth — a claim can be ACTIVE with
   * no sealed webhook secret yet, which is exactly the state where an order is
   * accepted, charged, and then never delivered. The partner UI renders this
   * instead of asserting "ACTIVE", so a restaurant is never told it is live
   * while the bridge would refuse to POST.
   */
  ready: boolean;
  /** Which of the three facts is missing, so the partner can be told why. */
  notReadyReason: "webhook_secret" | "pos_restaurant_id" | "inactive" | null;
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
  const { ready, notReadyReason } = integrationReadiness(row.rec);
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
    ready,
    notReadyReason,
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
  const { ready, notReadyReason } = integrationReadiness(record);
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
    ready,
    notReadyReason,
  };
}

/* -------------------------------- audit ---------------------------------- */

export type IntegrationAuditContext = {
  /** `ops` is an operator acting through the privileged surface, not the restaurant. */
  actor: "restaurant" | "partner" | "system" | "ops";
  ipAddress?: string | null;
  userAgent?: string | null;
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
      // `userAgent` rides in the JSONB detail rather than its own column: it is
      // free-form diagnostic context, not something the trail is ever queried
      // on, and the audit table's columns are the ones support queries against.
      detail: ctx.userAgent != null ? { ...(detail ?? {}), userAgent: ctx.userAgent } : (detail ?? {}),
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

/* --------------------------- identity transfers --------------------------- */

/**
 * Who currently holds a POS identity (`restaurants.marketplace_id`).
 *
 * Returns null when nobody does. That is a real state, not an error: disconnect
 * and transfer both clear the column, so "unheld" is how a listing that gave up
 * an identity looks afterwards.
 */
export async function getMarketplaceIdHolder(
  marketplaceId: string,
): Promise<{ id: number; name: string; slug: string } | null> {
  const id = String(marketplaceId ?? "").trim();
  if (!id) return null;
  const [row] = await db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(eq(restaurants.marketplaceId, id))
    .limit(1);
  return row ?? null;
}

/** The open request from this listing, if any — the one the UI must not duplicate. */
export async function findPendingTransferFor(
  requestedByRestaurantId: number,
): Promise<{ id: number; status: string; requestedAt: string; heldBy: { id: number; name: string; slug: string } | null } | null> {
  const [row] = await db
    .select({
      id: integrationTransferRequests.id,
      status: integrationTransferRequests.status,
      requestedAt: integrationTransferRequests.requestedAt,
      marketplaceId: integrationTransferRequests.marketplaceId,
    })
    .from(integrationTransferRequests)
    .where(
      and(
        eq(integrationTransferRequests.requestedByRestaurantId, requestedByRestaurantId),
        eq(integrationTransferRequests.status, "pending"),
      ),
    )
    .orderBy(desc(integrationTransferRequests.requestedAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    heldBy: await getMarketplaceIdHolder(row.marketplaceId),
  };
}

/**
 * Record (or refresh) a listing's request to take a POS identity from another
 * listing.
 *
 * Read-then-write against the partial unique index rather than an
 * ON CONFLICT target: the index is WHERE status='pending', and spelling that
 * predicate into a conflict target made the statement depend on the index
 * definition matching exactly. A duplicate ask is not an error anyway — the
 * operator pressing the button twice should refresh the note, not 500 — so the
 * race that can still slip through is caught and folded into the same update.
 */
export async function requestIntegrationTransfer(input: {
  requestedByRestaurantId: number;
  previousRestaurantId: number;
  marketplaceId: string;
  posRestaurantId?: string | null;
  note?: string | null;
  ipAddress?: string | null;
}): Promise<{ id: number; status: string; requestedAt: string; heldBy: { id: number; name: string; slug: string } | null }> {
  const marketplaceId = String(input.marketplaceId ?? "").trim();
  if (!marketplaceId) throw new Error("marketplaceId is required");

  const refresh = async () => {
    const [updated] = await db
      .update(integrationTransferRequests)
      .set({
        posRestaurantId: input.posRestaurantId ?? undefined,
        note: input.note ?? undefined,
        requestedByIp: input.ipAddress ?? undefined,
        requestedAt: new Date(),
      })
      .where(
        and(
          eq(integrationTransferRequests.marketplaceId, marketplaceId),
          eq(integrationTransferRequests.requestedByRestaurantId, input.requestedByRestaurantId),
          eq(integrationTransferRequests.status, "pending"),
        ),
      )
      .returning({ id: integrationTransferRequests.id, status: integrationTransferRequests.status, requestedAt: integrationTransferRequests.requestedAt });
    if (!updated) throw new Error("transfer request disappeared");
    return {
      id: updated.id,
      status: updated.status,
      requestedAt: updated.requestedAt.toISOString(),
      heldBy: await getMarketplaceIdHolder(marketplaceId),
    };
  };

  const [existing] = await db
    .select({ id: integrationTransferRequests.id })
    .from(integrationTransferRequests)
    .where(
      and(
        eq(integrationTransferRequests.marketplaceId, marketplaceId),
        eq(integrationTransferRequests.requestedByRestaurantId, input.requestedByRestaurantId),
        eq(integrationTransferRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) return refresh();

  try {
    const [inserted] = await db
      .insert(integrationTransferRequests)
      .values({
        requestedByRestaurantId: input.requestedByRestaurantId,
        previousRestaurantId: input.previousRestaurantId,
        marketplaceId,
        posRestaurantId: input.posRestaurantId ?? null,
        note: input.note ?? null,
        requestedByIp: input.ipAddress ?? null,
      })
      .returning({ id: integrationTransferRequests.id, status: integrationTransferRequests.status, requestedAt: integrationTransferRequests.requestedAt });
    return {
      id: inserted.id,
      status: inserted.status,
      requestedAt: inserted.requestedAt.toISOString(),
      heldBy: await getMarketplaceIdHolder(marketplaceId),
    };
  } catch (err) {
    // 23505: another request landed between the read and the insert. The partial
    // unique index did its job; fold the loser into the same refresh path.
    if ((err as { code?: string })?.code === "23505") return refresh();
    throw err;
  }
}

export interface IntegrationTransferDto {
  id: number;
  status: string;
  marketplaceId: string;
  posRestaurantId: string | null;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  requestedBy: { id: number; name: string; slug: string };
  heldBy: { id: number; name: string; slug: string } | null;
  holderRecordStatus: string | null;
  holderStats: { orders: number; openOrders: number };
}

/**
 * The ops transfer queue.
 *
 * Batched deliberately: the naive shape (per request, load holder + order counts)
 * is a handful of queries per row on a queue an operator refreshes constantly.
 * Order counts are grouped because `orders` is the largest table touched and the
 * per-listing totals are all that is displayed.
 */
export async function listIntegrationTransfers(
  statuses: string[] = ["pending"],
): Promise<IntegrationTransferDto[]> {
  const wanted = statuses.length ? statuses : ["pending"];
  const requests = await db
    .select()
    .from(integrationTransferRequests)
    .where(inArray(integrationTransferRequests.status, wanted))
    .orderBy(desc(integrationTransferRequests.requestedAt))
    .limit(50);
  if (!requests.length) return [];

  const restaurantIds = [
    ...new Set(requests.flatMap((r) => [r.requestedByRestaurantId, r.previousRestaurantId])),
  ];

  const listingRows = await db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(inArray(restaurants.id, restaurantIds));
  const byId = new Map(listingRows.map((r) => [r.id, r]));

  const orderCounts = await db
    .select({ restaurantId: orders.restaurantId, total: sql<number>`count(*)::int` })
    .from(orders)
    .where(inArray(orders.restaurantId, restaurantIds))
    .groupBy(orders.restaurantId);
  const totalById = new Map(orderCounts.map((r) => [r.restaurantId, Number(r.total)]));

  const openRows = await db
    .select({ restaurantId: orders.restaurantId, total: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(inArray(orders.restaurantId, restaurantIds), OPEN_ORDER_PREDICATE))
    .groupBy(orders.restaurantId);
  const openById = new Map(openRows.map((r) => [r.restaurantId, Number(r.total)]));

  const recordRows = await db
    .select({
      restaurantId: integrationRecords.restaurantId,
      status: integrationRecords.status,
    })
    .from(integrationRecords)
    .where(inArray(integrationRecords.restaurantId, restaurantIds));
  const recordById = new Map(recordRows.map((r) => [r.restaurantId, r.status]));

  return requests.map((r) => {
    const holder = byId.get(r.previousRestaurantId) ?? null;
    return {
      id: r.id,
      status: r.status,
      marketplaceId: r.marketplaceId,
      posRestaurantId: r.posRestaurantId,
      note: r.note,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decidedBy: r.decidedBy,
      requestedBy: byId.get(r.requestedByRestaurantId) ?? { id: r.requestedByRestaurantId, name: "Unknown", slug: "" },
      heldBy: holder,
      holderRecordStatus: recordById.get(r.previousRestaurantId) ?? null,
      holderStats: {
        orders: totalById.get(r.previousRestaurantId) ?? 0,
        openOrders: openById.get(r.previousRestaurantId) ?? 0,
      },
    };
  });
}

export type TransferDecisionResult =
  | {
      ok: true;
      outcome: "approved" | "denied";
      requestId: number;
      grantedTo: number;
      releasedFrom: number;
      marketplaceId: string;
      /** False when the requester's record still lacks a webhook secret. */
      activated: boolean;
      warnings: string[];
    }
  | { ok: false; code: string; error: string };

/**
 * Ops approval/denial of an identity transfer.
 *
 * The plan comes from the pure `planTransferApproval`, so the conditions under
 * which an identity may move are unit-tested rather than asserted in a route.
 * The writes then run in one transaction with two deliberate compare-and-set
 * guards:
 *
 *   - the request UPDATE is scoped to status='pending' and checked, so two
 *     operators clicking Approve at once cannot both apply;
 *   - the UNIQUE constraint on restaurants.marketplace_id is the final arbiter.
 *     The holder was read just before the transaction, so a third listing
 *     grabbing the id in that window surfaces as a clean refusal rather than a
 *     half-applied move.
 */
export async function decideIntegrationTransfer(input: {
  requestId: number;
  decision: "approved" | "denied";
  actor: string;
  ipAddress?: string | null;
  note?: string | null;
}): Promise<TransferDecisionResult> {
  const [request] = await db
    .select()
    .from(integrationTransferRequests)
    .where(eq(integrationTransferRequests.id, input.requestId))
    .limit(1);
  if (!request) {
    return { ok: false, code: "TRANSFER_NOT_FOUND", error: "No such transfer request" };
  }

  if (input.decision === "denied") {
    const [denied] = await db
      .update(integrationTransferRequests)
      .set({
        status: "denied",
        decidedAt: new Date(),
        decidedBy: input.actor,
        ...(input.note ? { note: input.note } : {}),
      })
      .where(and(eq(integrationTransferRequests.id, input.requestId), eq(integrationTransferRequests.status, "pending")))
      .returning({ id: integrationTransferRequests.id });
    if (!denied) {
      return { ok: false, code: "TRANSFER_NOT_PENDING", error: "This request was already decided." };
    }
    await recordIntegrationAudit(
      request.requestedByRestaurantId,
      "pos_integration_transfer_denied",
      { actor: "ops", ipAddress: input.ipAddress },
      { request_id: request.id, marketplace_id: request.marketplaceId, note: input.note ?? null },
    );
    return {
      ok: true,
      outcome: "denied",
      requestId: request.id,
      grantedTo: 0,
      releasedFrom: 0,
      marketplaceId: request.marketplaceId,
      activated: false,
      warnings: [],
    };
  }

  // Snapshot everything the plan reasons about, in one pass per concern.
  const holder = await getMarketplaceIdHolder(request.marketplaceId);
  const [requester] = await db
    .select({ marketplaceId: restaurants.marketplaceId })
    .from(restaurants)
    .where(eq(restaurants.id, request.requestedByRestaurantId))
    .limit(1);
  const records = await db
    .select({
      restaurantId: integrationRecords.restaurantId,
      status: integrationRecords.status,
      posRestaurantId: integrationRecords.posRestaurantId,
      webhookSecret: integrationRecords.webhookSecret,
    })
    .from(integrationRecords)
    .where(
      inArray(integrationRecords.restaurantId, [
        request.requestedByRestaurantId,
        request.previousRestaurantId,
      ]),
    );
  const recordFor = (id: number) => records.find((r) => r.restaurantId === id) ?? null;

  const counts = await db
    .select({
      restaurantId: orders.restaurantId,
      total: sql<number>`count(*)::int`,
      // `count(*) FILTER (WHERE …)` is the idiomatic Postgres form, but FILTER
      // is a reserved word and drizzle emits the raw fragment unquoted, which
      // Postgres rejects with 42601 at "filter". `sum(case …)` says the same
      // thing without the reserved keyword.
      open: sql<number>`sum(case when ${OPEN_ORDER_PREDICATE} then 1 else 0 end)::int`,
    })
    .from(orders)
    .where(
      inArray(orders.restaurantId, [request.requestedByRestaurantId, request.previousRestaurantId]),
    )
    .groupBy(orders.restaurantId);
  const statsFor = (id: number) => {
    const row = counts.find((c) => c.restaurantId === id);
    return { orders: Number(row?.total ?? 0), openOrders: Number(row?.open ?? 0) };
  };

  const requesterRecord = recordFor(request.requestedByRestaurantId);
  const holderRecord = recordFor(request.previousRestaurantId);

  const snapshot: TransferStateSnapshot = {
    request: {
      id: request.id,
      requestedByRestaurantId: request.requestedByRestaurantId,
      previousRestaurantId: request.previousRestaurantId,
      marketplaceId: request.marketplaceId,
      status: request.status,
    },
    currentHolderId: holder?.id ?? null,
    requesterMarketplaceId: requester?.marketplaceId ?? null,
    requesterRecord: requesterRecord
      ? { status: requesterRecord.status, posRestaurantId: requesterRecord.posRestaurantId }
      : null,
    holderRecord: holderRecord
      ? { status: holderRecord.status, posRestaurantId: holderRecord.posRestaurantId }
      : null,
    holderStats: statsFor(request.previousRestaurantId),
  };

  const plan: TransferDecision = planTransferApproval(snapshot);
  if (!plan.ok) {
    return { ok: false, code: plan.code, error: plan.error };
  }

  const activate = requesterRecord
    ? shouldActivateOnApproval({
        status: requesterRecord.status,
        posRestaurantId: requesterRecord.posRestaurantId,
        hasWebhookSecret: !!requesterRecord.webhookSecret,
      })
    : false;

  try {
    await db.transaction(async (tx) => {
      // ORDER MATTERS: release the holder BEFORE granting.
      //
      // `restaurants_marketplace_id_unique` is an immediate (non-deferred)
      // constraint, so it is checked per statement, not at commit. Granting
      // first therefore cannot succeed while the holder still owns the id — it
      // fails 23505 every time, which is what the first version of this
      // transaction did. Clearing the holder first is what makes the move legal
      // at all.
      //
      // The same immediacy is what makes it safe: if a third listing claimed the
      // id in the window between the snapshot and here, the GRANT is what trips
      // the constraint, the transaction rolls back the release with it, and the
      // caller gets IDENTITY_TAKEN instead of a half-applied move.
      await tx
        .update(restaurants)
        .set({ marketplaceId: null })
        .where(eq(restaurants.id, plan.releaseFromRestaurantId));

      // The holder loses the id outright rather than being re-minted one. A
      // fresh id would imply the POS still answers to it; NULL says plainly that
      // it does not, and getOrCreateMarketplaceId mints a correct one when that
      // listing legitimately reconnects later.
      await tx
        .update(restaurants)
        .set({ marketplaceId: plan.marketplaceId })
        .where(eq(restaurants.id, plan.grantMarketplaceIdTo));

      // Close the outgoing record so the ordering gate and the delivery journal
      // stop treating it as live. lastError is what the console shows, so the
      // listing does not just go dark with no explanation.
      await tx
        .update(integrationRecords)
        .set({ status: "disabled", lastError: plan.releaseReason, updatedAt: new Date() })
        .where(eq(integrationRecords.restaurantId, plan.releaseFromRestaurantId));

      if (activate) {
        await tx
          .update(integrationRecords)
          .set({ status: "active", connectedAt: new Date(), updatedAt: new Date() })
          .where(eq(integrationRecords.restaurantId, plan.grantMarketplaceIdTo));
      }

      const [decided] = await tx
        .update(integrationTransferRequests)
        .set({
          status: "approved",
          decidedAt: new Date(),
          decidedBy: input.actor,
          ...(input.note ? { note: input.note } : {}),
        })
        .where(
          and(
            eq(integrationTransferRequests.id, input.requestId),
            eq(integrationTransferRequests.status, "pending"),
          ),
        )
        .returning({ id: integrationTransferRequests.id });
      if (!decided) {
        // Another operator got there first; abort so nothing above is committed.
        throw new TransferAbortedError();
      }
    });
  } catch (err) {
    if (err instanceof TransferAbortedError) {
      return { ok: false, code: "TRANSFER_NOT_PENDING", error: "This request was already decided." };
    }
    if ((err as { code?: string })?.code === "23505") {
      return {
        ok: false,
        code: "IDENTITY_TAKEN",
        error: "Another listing claimed that identity while you were deciding. Reload the queue.",
      };
    }
    throw err;
  }

  // Both sides are audited: the requester gained a capability, and the holder
  // silently lost its ability to take orders, which is the part that would
  // otherwise be invisible after the fact.
  await recordIntegrationAudit(
    plan.grantMarketplaceIdTo,
    "pos_integration_transfer_granted",
    { actor: "ops", ipAddress: input.ipAddress },
    { request_id: request.id, marketplace_id: plan.marketplaceId, activated: activate, warnings: plan.warnings },
  );
  await recordIntegrationAudit(
    plan.releaseFromRestaurantId,
    "pos_integration_transfer_released",
    { actor: "ops", ipAddress: input.ipAddress },
    {
      request_id: request.id,
      marketplace_id: plan.marketplaceId,
      moved_to: plan.grantMarketplaceIdTo,
      orders_at_transfer: snapshot.holderStats.orders,
      open_orders_at_transfer: snapshot.holderStats.openOrders,
    },
  );

  return {
    ok: true,
    outcome: "approved",
    requestId: request.id,
    grantedTo: plan.grantMarketplaceIdTo,
    releasedFrom: plan.releaseFromRestaurantId,
    marketplaceId: plan.marketplaceId,
    activated: activate,
    warnings: plan.warnings,
  };
}

/** Thrown to roll back a transaction whose compare-and-set guard lost the race. */
class TransferAbortedError extends Error {
  constructor() {
    super("transfer already decided");
    this.name = "TransferAbortedError";
  }
}

/**
 * Rotate the passkey for an already-authenticated restaurant.
 *
 * The BEARER session is the proof. `POST
 * /api/integration/passkey/rotate` requires a live integration session, and
 * `requireIntegrationAuth` has already resolved that session to this
 * restaurant — so the passkey being replaced no longer has to travel back over
 * the wire as a body field. A credential's rotation should not require
 * sending the credential. That is the whole reason the session endpoint
 * exists; the old code+passkey body was a fallback from before sessions, and
 * the route that could be reached with nothing but the secret being replaced
 * is gone.
 *
 * Writes `integration_passkey_hash` only. `owner_key_hash` is a different
 * credential now and is left alone — a rotated integration must never strand
 * the restaurant owner with a dead /partner key.
 *
 * The caller is expected to `revokeIntegrationSessions` afterwards: an old
 * passkey holder who had already minted sessions must not outlive the
 * rotation in them.
 */
export async function rotatePasskeyAsRestaurant(
  restaurantId: number,
): Promise<{ ok: true; passkey: string } | { ok: false; error: string }> {
  const next = makeOwnerKey();
  await db
    .update(restaurants)
    .set({ integrationPasskeyHash: hashOwnerKey(next) })
    .where(eq(restaurants.id, restaurantId));
  return { ok: true, passkey: next };
}

/**
 * Rotate the Marketplace owner key from the partner surface, proving control
 * with the CURRENT key.
 *
 * The exact mirror image of `rotatePasskeyAsRestaurant`: this writes
 * `owner_key_hash` ONLY and leaves `integration_passkey_hash` alone, so
 * rotating a suspected-compromised /partner key can never break the POS login
 * the restaurant's terminal depends on. Getting that separation wrong in either
 * direction is what the "split POS passkey from owner key" migration fixed.
 *
 * This is safe to self-serve because it requires the credential being replaced,
 * so it is deliberately NOT a recovery path — a restaurant that has LOST the key
 * still needs an operator. It only removes the round-trip for the case where a
 * partner still holds the old key and simply wants a new one.
 */
export async function rotateOwnerKeyAsRestaurant(
  restaurantId: number,
  currentOwnerKey: string,
): Promise<{ ok: true; ownerKey: string } | { ok: false; error: string }> {
  const current = String(currentOwnerKey ?? "");
  if (!current) return { ok: false, error: "Current owner key is required" };
  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!r || !ownerKeyMatches(r.ownerKeyHash, current)) return { ok: false, error: "Invalid owner key" };

  const next = makeOwnerKey();
  await db
    .update(restaurants)
    .set({ ownerKeyHash: hashOwnerKey(next) })
    .where(eq(restaurants.id, restaurantId));
  return { ok: true, ownerKey: next };
}

/* ---------------------------- ops provisioning --------------------------- */

/**
 * Per-listing readiness for the POS handshake, as ops sees it.
 *
 * A listing can only complete /partner/integrations when it has BOTH:
 *   - ownerKeyHash  : proves ownership on the Marketplace side
 *   - externalId    : the stable id the POS is matched on
 * Listings seeded straight into the database have neither, which is why they
 * cannot be connected without an operator provisioning them first.
 */
export interface ListingSetupDto {
  id: number;
  name: string;
  slug: string;
  externalId: string | null;
  hasOwnerKey: boolean;
  posLinked: boolean;
  posRestaurantId: string | null;
  recordStatus: string | null;
  /** True when a single ops call would make the listing connectable. */
  needsSetup: boolean;
  /** Merchandising state: drives the home page "Featured tonight" rail. */
  featured: boolean;
  isActive: boolean;
}

export async function listListingSetup(): Promise<ListingSetupDto[]> {
  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      externalId: restaurants.externalId,
      ownerKeyHash: restaurants.ownerKeyHash,
      featured: restaurants.featured,
      isActive: restaurants.isActive,
      posRestaurantId: integrationRecords.posRestaurantId,
      recordStatus: integrationRecords.status,
    })
    .from(restaurants)
    .leftJoin(integrationRecords, eq(integrationRecords.restaurantId, restaurants.id))
    .orderBy(restaurants.id);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    externalId: r.externalId ?? null,
    hasOwnerKey: !!r.ownerKeyHash,
    posLinked: !!r.posRestaurantId,
    posRestaurantId: r.posRestaurantId ?? null,
    recordStatus: r.recordStatus ?? null,
    needsSetup: !r.ownerKeyHash || !r.externalId,
    featured: r.featured,
    isActive: r.isActive,
  }));
}

/**
 * Ops-only merchandising toggle for the home page "Featured tonight" rail.
 *
 * `featured` used to be settable only by the seed script, so the rail — the
 * single most valuable slot on the home page — was whatever the database
 * happened to say at seed time, with no way for an operator to change it. It
 * is also the tiebreaker in the default browse sort
 * (`desc(featured), desc(rating)`), so a newly onboarded restaurant that
 * nobody can feature is permanently last in the default listing.
 *
 * Ops-gated rather than partner-gated: featuring is a platform merchandising
 * decision, not something a restaurant should be able to grant itself.
 */
export async function setFeaturedAsOps(
  restaurantId: number,
  featured: boolean,
): Promise<{ ok: true; restaurant: { id: number; name: string; featured: boolean } } | { ok: false; error: string; code?: string }> {
  const next = Boolean(featured);
  const [row] = await db
    .update(restaurants)
    .set({ featured: next })
    .where(eq(restaurants.id, restaurantId))
    .returning({ id: restaurants.id, name: restaurants.name, featured: restaurants.featured });
  if (!row) return { ok: false, error: "Listing not found", code: "NOT_FOUND" };
  return { ok: true, restaurant: row };
}

export interface ProvisionListingInput {
  restaurantId: number;
  /** Optional. Only honoured when the listing has no external id yet. */
  externalId?: string | null;
  /**
   * Replace an existing owner key. Off by default: backfilling a missing
   * external id on a connected listing must not invalidate the key that
   * restaurant already holds.
   */
  rotateOwnerKey?: boolean;
}

/**
 * Ops-only bootstrap for a listing that cannot complete the POS handshake:
 * backfills `external_id` if it is missing and issues a fresh owner key.
 *
 * Why this exists instead of reusing rotateOwnerKeyAsRestaurant: rotation
 * requires the CURRENT key, so a lost key is unrecoverable by design. Seeded
 * listings never had a key at all, and the /partner redemption flow that
 * normally issues one requires an `external_id` they also never had. Without
 * an ops path, every such listing is stranded and has to be repaired by
 * hand-editing the database.
 *
 * The new key is returned exactly once, like every other owner key.
 */
export async function provisionListingAsOps(input: ProvisionListingInput):
  Promise<
    | {
        ok: true;
        restaurantId: number;
        /** The new plaintext key, or null when an existing one was preserved. */
        ownerKey: string | null;
        externalId: string;
        /** Set when an existing key was replaced, so ops can warn the operator. */
        rotated: boolean;
        /** Set when nothing needed changing. */
        unchanged?: boolean;
      }
    | { ok: false; error: string; code: string }
  > {
  const id = Math.floor(Number(input?.restaurantId));
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "A valid restaurant id is required", code: "INVALID_RESTAURANT_ID" };
  }

  const [r] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  if (!r) return { ok: false, error: "Listing not found", code: "NOT_FOUND" };

  // An existing key is PRESERVED unless the caller explicitly asks to replace
  // it. Backfilling a missing external id must not silently invalidate a key the
  // restaurant has already stored, which is the common ops case for listings
  // that are connected but were seeded without an external id.
  const hadKey = !!r.ownerKeyHash;
  const rotate = hadKey && input?.rotateOwnerKey === true;
  const ownerKey = hadKey && !rotate ? null : makeOwnerKey();
  const patch: { ownerKeyHash?: string; externalId?: string; integrationPasskeyHash?: string } = {};
  if (ownerKey) {
    patch.ownerKeyHash = hashOwnerKey(ownerKey);
    // Seed the POS passkey only while it is still unset. An ops-issued owner key
    // is the only credential a seeded listing has, so the POS has to be able to
    // log in with it — but once the listing has its own passkey (i.e. the POS
    // has rotated at least once) the owner key must stop working as one, or
    // rotation would be reversible by anyone holding the key ops just minted.
    if (!r.integrationPasskeyHash) patch.integrationPasskeyHash = patch.ownerKeyHash;
  }

  let externalId = r.externalId ?? "";
  if (!externalId) {
    const requested = String(input?.externalId ?? "").trim().slice(0, 64);
    if (!requested) {
      return {
        ok: false,
        error: "This listing has no external id; supply one to provision it",
        code: "EXTERNAL_ID_REQUIRED",
      };
    }
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(requested)) {
      return { ok: false, error: "External id must be 3-64 letters, digits, dash or underscore", code: "INVALID_EXTERNAL_ID" };
    }
    const [clash] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.externalId, requested))
      .limit(1);
    if (clash) {
      return { ok: false, error: `External id already used by listing ${clash.id}`, code: "EXTERNAL_ID_TAKEN" };
    }
    externalId = requested;
    patch.externalId = requested;
  }

  // Nothing to do: the listing is already fully provisioned and no rotation was
  // requested. Say so rather than issuing a pointless new key.
  if (!ownerKey && !patch.externalId) {
    return {
      ok: true,
      restaurantId: id,
      ownerKey: null,
      externalId,
      rotated: false,
      unchanged: true,
    };
  }

  try {
    await db.update(restaurants).set(patch).where(eq(restaurants.id, id));
  } catch (e) {
    // A concurrent provision can win the unique external_id race between the
    // check above and this write; surface it as a retryable conflict.
    if (isUniqueViolation(e)) {
      return { ok: false, error: "External id was just taken by another listing", code: "EXTERNAL_ID_TAKEN" };
    }
    throw e;
  }

  return { ok: true, restaurantId: id, ownerKey, externalId, rotated: rotate };
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
  /** Absent → the row's "Home" default applies. */
  addressLabel?: string;
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
  | { ok: false; error: string; code?: string }
> {
  const [r] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.slug, restaurantSlug))
    .limit(1);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!r.isActive) return { ok: false, error: `${r.name} is temporarily closed` };
  if (!items.length) return { ok: false, error: "Cart is empty" };

  // Ordering gate. Enforced before any line is priced so the bill preview and
  // the order itself agree — the customer is told at the estimate, not after
  // entering payment details.
  if (orderingGateEnforced() && !(await hasActiveIntegration(r.id))) {
    return {
      ok: false,
      error: ORDERING_CLOSED_MESSAGE,
      code: "INTEGRATION_NOT_CONNECTED",
    };
  }

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
    // Backstop, not the gate: checkout and the bill preview both reject
    // quantities outside 1..MAX_ITEM_QUANTITY before this runs (see
    // order-input-core). The clamp stays so a future direct caller cannot bill
    // a quantity the customer did not ask for — and its bound is the SAME
    // bound the routes enforce, or a quantity the routes accepted would be
    // silently rewritten here.
    const qty = Math.min(MAX_ITEM_QUANTITY, Math.max(1, Math.floor(item.quantity) || 1));

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
): Promise<{ ok: true; order: OrderDto; trackingToken?: string } | { ok: false; error: string; code?: string }> {
  const clientRequestId = String(input.clientRequestId ?? "").trim().slice(0, 80) || null;

  if (clientRequestId) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(eq(orders.clientRequestId, clientRequestId))
      .limit(1);
    // An idempotent retry only has the hash on disk, never the plaintext token
    // (that was returned once, on the winning request), so `trackingToken` is
    // absent here. The checkout route simply omits it and the browser keeps the
    // code + HMAC pair for this order.
    if (existing) return { ok: true, order: toOrderDto(existing) };
  }

  // Phase 6 — mint the bearer tracking token once, here at creation. Only its
  // hash is stored; the plaintext rides back through the checkout response the
  // single time it is ever available.
  const trackingToken = makeTrackingToken();

  const computed = await computeBill(input.restaurantSlug, input.items);
  if (!computed.ok) return { ok: false, error: computed.error, code: computed.code };
  const { restaurant: r, lines, bill } = computed;

  // The gate decision is stamped on the order rather than re-derived later, so
  // tracking shows the POS lifecycle this order was actually admitted into even
  // if the restaurant's integration is disabled while the order is in flight.
  const posConnected = await hasActiveIntegration(r.id);

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
        trackingTokenHash: hashTrackingToken(trackingToken),
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
        posConnected,
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

    return { ok: true, order: toOrderDto(created), trackingToken };
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

/**
 * Resolve an order by its bearer tracking token (Phase 6). The caller validates
 * the token's shape before this runs; here the token is only ever hashed and
 * compared against the stored digest — the plaintext never touches the query,
 * so a leaked query log cannot be used as a working tracking URL either.
 */
export async function getOrderByTrackingToken(token: string): Promise<OrderDto | null> {
  const [o] = await db
    .select()
    .from(orders)
    .where(eq(orders.trackingTokenHash, hashTrackingToken(token)))
    .limit(1);
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
