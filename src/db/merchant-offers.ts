import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { merchantOffers } from "@/db/schema";
import type { MerchantOfferInput } from "@/lib/merchant-offer";

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
