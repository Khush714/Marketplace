import { db } from "@/db";
import { categories, menuItems, restaurants } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * External id mapping layer (PHASE 35).
 *
 * Every syncable menu row carries a marketplace id in addition to the id the
 * RestaurantAI/POS publishes. These helpers are the deterministic bridge
 * between the two:
 *
 *   Marketplace "Butter Chicken" item_123  <->  RestaurantAI "Butter Chicken" pos_item_829
 *
 * Uniqueness is enforced by the per-restaurant partial unique indexes
 * (menu_items_external_key / categories_external_key), so a lookup here can
 * never be ambiguous. Writes through the admin editor keep the same promise.
 */

/** Normalizes a user/system-supplied external id: trimmed, or null if blank. */
export function cleanExternalId(
  value: string | null | undefined,
): string | null {
  const s = (value ?? "").trim();
  return s ? s : null;
}

/**
 * Resolves a RestaurantAI/POS item id to the marketplace row. Returns null
 * when the restaurant has no such mapping.
 */
export async function findItemByExternalId(
  restaurantId: number,
  externalId: string,
): Promise<{ id: number; marketplaceId: string; name: string } | null> {
  const id = cleanExternalId(externalId);
  if (!id) return null;
  const [row] = await db
    .select({
      id: menuItems.id,
      marketplaceId: menuItems.marketplaceId,
      name: menuItems.name,
    })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.restaurantId, restaurantId),
        eq(menuItems.externalId, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Resolves an external category id to the marketplace row, or null.
 */
export async function findCategoryByExternalId(
  restaurantId: number,
  externalId: string,
): Promise<{ id: number; marketplaceId: string; name: string } | null> {
  const id = cleanExternalId(externalId);
  if (!id) return null;
  const [row] = await db
    .select({
      id: categories.id,
      marketplaceId: categories.marketplaceId,
      name: categories.name,
    })
    .from(categories)
    .where(
      and(
        eq(categories.restaurantId, restaurantId),
        eq(categories.externalId, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Resolves a marketplace item id ("item_…") to the restaurant's serial row id.
 * Returns null when the food exists but not for this restaurant, or when it
 * does not exist at all.
 */
export async function findItemByMarketplaceId(
  restaurantId: number,
  marketplaceId: string,
): Promise<{ id: number; itemId: string } | null> {
  const [row] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.restaurantId, restaurantId),
        eq(menuItems.marketplaceId, marketplaceId),
      ),
    )
    .limit(1);
  return row ? { id: row.id, itemId: marketplaceId } : null;
}

/**
 * Resolves an external id to a restaurant by slug (admin/lookup convenience).
 */
export async function resolveExternalItem(
  slug: string,
  externalId: string,
): Promise<{ restaurantId: number; item: { id: number; name: string } | null } | null> {
  const [r] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!r) return null;
  const item = await findItemByExternalId(r.id, externalId);
  return { restaurantId: r.id, item };
}