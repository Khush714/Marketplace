import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customerCarts } from "@/db/schema";
import { normalizeCartState, type CartStateLike } from "@/lib/cart-sync-core";

const EMPTY: CartStateLike = { restaurantSlug: "", restaurantName: "", items: [] };

export async function getCustomerCart(accountId: number): Promise<CartStateLike> {
  const [row] = await db
    .select({ state: customerCarts.state })
    .from(customerCarts)
    .where(eq(customerCarts.accountId, accountId))
    .limit(1);
  return normalizeCartState(row?.state) ?? EMPTY;
}

/** Server-side normalization is the write boundary: no arbitrary JSON is stored. */
export async function saveCustomerCart(accountId: number, raw: unknown): Promise<CartStateLike> {
  const state = normalizeCartState(raw) ?? EMPTY;
  await db
    .insert(customerCarts)
    .values({ accountId, state })
    .onConflictDoUpdate({
      target: customerCarts.accountId,
      set: { state, updatedAt: new Date() },
    });
  return state;
}
