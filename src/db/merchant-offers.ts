import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { merchantOffers, orders, restaurants } from "@/db/schema";
import {
  publicMerchantOfferDto,
  type MerchantOfferInput,
  type PublicMerchantOffer,
} from "@/lib/merchant-offer";

/** Every read and write is scoped to the restaurant resolved from the bearer token. */
export async function listMerchantOffers(restaurantId: number) {
  return db.select().from(merchantOffers)
    .where(eq(merchantOffers.restaurantId, restaurantId))
    .orderBy(desc(merchantOffers.createdAt)).limit(500);
}

export async function findMerchantOffer(restaurantId: number, id: string) {
  const [row] = await db.select().from(merchantOffers)
    .where(and(eq(merchantOffers.restaurantId, restaurantId), eq(merchantOffers.id, id), eq(merchantOffers.archived, false)))
    .limit(1);
  return row ?? null;
}

function toColumns(input: MerchantOfferInput) {
  return {
    code: input.code,
    title: input.title,
    description: input.description,
    discountType: input.discountType,
    value: input.value,
    minOrder: input.minOrder,
    maxDiscount: input.maxDiscount,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    usageLimit: input.usageLimit,
    active: input.active,
  };
}

export async function createMerchantOffer(restaurantId: number, input: MerchantOfferInput) {
  const [row] = await db.insert(merchantOffers).values({ ...toColumns(input), restaurantId }).returning();
  return row;
}

export async function updateMerchantOffer(restaurantId: number, id: string, changes: Partial<ReturnType<typeof toColumns>> & { active?: boolean }) {
  const [row] = await db.update(merchantOffers)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(merchantOffers.restaurantId, restaurantId), eq(merchantOffers.id, id), eq(merchantOffers.archived, false)))
    .returning();
  return row ?? null;
}

export async function archiveMerchantOffer(restaurantId: number, id: string) {
  const [row] = await db.update(merchantOffers)
    .set({ archived: true, active: false, updatedAt: new Date() })
    .where(and(eq(merchantOffers.restaurantId, restaurantId), eq(merchantOffers.id, id), eq(merchantOffers.archived, false)))
    .returning({ id: merchantOffers.id });
  return Boolean(row);
}

/**
 * Redemptions are read from the orders that actually used each code. COUNT is
 * cast to int so the driver gives the policy layer a number, not pg's bigint
 * string. Every order with a stamp counts, including cancelled ones — releasing
 * capacity on cancellation would let a single customer churn a limited offer.
 */
export async function redemptionCountsForRestaurant(restaurantId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ code: orders.offerCode, redemptions: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.restaurantId, restaurantId), isNotNull(orders.offerCode)))
    .groupBy(orders.offerCode);
  return new Map(rows.map((r) => [r.code as string, Number(r.redemptions)]));
}

/** Active, unarchived offers with real redemption counts, newest first. */
function selectPublicOffers(restaurantId: number) {
  return db
    .select({
      offer: merchantOffers,
      redemptions: sql<number>`count(${orders.id})::int`,
    })
    .from(merchantOffers)
    .leftJoin(
      orders,
      and(
        eq(orders.restaurantId, merchantOffers.restaurantId),
        eq(orders.offerCode, merchantOffers.code),
      ),
    )
    .where(and(
      eq(merchantOffers.restaurantId, restaurantId),
      eq(merchantOffers.active, true),
      eq(merchantOffers.archived, false),
    ))
    .groupBy(merchantOffers.id)
    .orderBy(desc(merchantOffers.createdAt))
    .limit(100);
}

/**
 * Public listing for a restaurant slug. Resolving the slug inside the accessor
 * means neither the page nor the API route can accidentally query offers with a
 * raw client-supplied id — the only public identity is the canonical slug.
 */
export async function listPublicMerchantOffersForSlug(
  slug: string,
  now = new Date(),
): Promise<PublicMerchantOffer[]> {
  const normalized = String(slug ?? "").trim().slice(0, 120);
  if (!normalized) return [];
  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(eq(restaurants.slug, normalized), eq(restaurants.isActive, true)))
    .limit(1);
  if (!restaurant) return [];
  const rows = await selectPublicOffers(restaurant.id);
  return rows.map(({ offer, redemptions }) => publicMerchantOfferDto(offer, Number(redemptions), now));
}

/**
 * Look up the row a customer's code can resolve to. Schedule, minimum order and
 * usage policy are evaluated by `evaluateMerchantOffer` on the bill path, so a
 * display-only DTO can never be the thing a discount is calculated from.
 */
export async function findRedeemableMerchantOffer(restaurantId: number, code: string) {
  const rows = await db
    .select({
      offer: merchantOffers,
      redemptions: sql<number>`count(${orders.id})::int`,
    })
    .from(merchantOffers)
    .leftJoin(
      orders,
      and(
        eq(orders.restaurantId, merchantOffers.restaurantId),
        eq(orders.offerCode, merchantOffers.code),
      ),
    )
    .where(and(
      eq(merchantOffers.restaurantId, restaurantId),
      eq(merchantOffers.code, code),
      eq(merchantOffers.active, true),
      eq(merchantOffers.archived, false),
    ))
    .groupBy(merchantOffers.id)
    .limit(1);
  const row = rows[0];
  return row ? { offer: row.offer, redemptions: Number(row.redemptions) } : null;
}
