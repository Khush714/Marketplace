import { db } from "@/db";
import { categories, menuItemModifierGroups, menuItemModifiers, menuItems, restaurants } from "@/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { num } from "./format";
import type {
  MenuCategoryContract,
  MenuItemContract,
  MenuModifierContract,
  MenuModifierGroupContract,
  MenuSyncResponse,
} from "./integration-contract";

/**
 * PHASE 11 — menu snapshot served to RestaurantAI via
 * GET /api/integration/menu. Authoritative view of the marketplace menu: all
 * categories and items (including unavailable ones — RestaurantAI must see the
 * full picture, not the customer's filtered view), keyed by the permanent
 * marketplace/external ids, with modifier groups resolved in two round trips.
 */
export async function getIntegrationMenu(
  restaurantId: number,
): Promise<MenuSyncResponse | null> {
  const [[restaurant], cats, items] = await Promise.all([
    db
      .select({
        name: restaurants.name,
        slug: restaurants.slug,
        marketplaceId: restaurants.marketplaceId,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1),
    db
      .select({
        id: categories.id,
        marketplaceId: categories.marketplaceId,
        externalId: categories.externalId,
        name: categories.name,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(eq(categories.restaurantId, restaurantId))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db
      .select({
        id: menuItems.id,
        marketplaceId: menuItems.marketplaceId,
        externalId: menuItems.externalId,
        name: menuItems.name,
        description: menuItems.description,
        price: menuItems.price,
        isAvailable: menuItems.isAvailable,
        isVegetarian: menuItems.isVegetarian,
        isPopular: menuItems.isPopular,
        categoryId: menuItems.categoryId,
      })
      .from(menuItems)
      .where(eq(menuItems.restaurantId, restaurantId))
      .orderBy(asc(menuItems.name)),
  ]);
  if (!restaurant) return null;

  const itemIds = items.map((i) => i.id);
  const [modGroups, modOptions] = itemIds.length
    ? await Promise.all([
        db
          .select()
          .from(menuItemModifierGroups)
          .where(inArray(menuItemModifierGroups.menuItemId, itemIds))
          .orderBy(
            asc(menuItemModifierGroups.menuItemId),
            asc(menuItemModifierGroups.sortOrder),
            asc(menuItemModifierGroups.id),
          ),
        db
          .select()
          .from(menuItemModifiers)
          .orderBy(
            asc(menuItemModifiers.groupId),
            asc(menuItemModifiers.sortOrder),
            asc(menuItemModifiers.id),
          ),
      ])
    : [[], []];

  const groupsByItem = new Map<number, MenuModifierGroupContract[]>();
  const modsByGroup = new Map<number, MenuModifierContract[]>();
  for (const m of modOptions) {
    const list = modsByGroup.get(m.groupId) ?? [];
    list.push({
      modifierId: m.id,
      name: m.name,
      priceDelta: num(m.priceDelta),
      available: m.isAvailable,
    });
    modsByGroup.set(m.groupId, list);
  }
  for (const g of modGroups) {
    const list = groupsByItem.get(g.menuItemId) ?? [];
    list.push({
      groupId: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      modifiers: modsByGroup.get(g.id) ?? [],
    });
    groupsByItem.set(g.menuItemId, list);
  }

  const categoryMarketplaceId = new Map(cats.map((c) => [c.id, c.marketplaceId]));

  const contractItems: MenuItemContract[] = items.map((i) => ({
    itemId: i.marketplaceId,
    externalId: i.externalId ?? null,
    name: i.name,
    description: i.description,
    price: num(i.price),
    available: i.isAvailable,
    vegetarian: i.isVegetarian,
    popular: i.isPopular,
    categoryId: i.categoryId ? (categoryMarketplaceId.get(i.categoryId) ?? null) : null,
    modifierGroups: groupsByItem.get(i.id) ?? [],
  }));

  const grouped = new Map<string, MenuCategoryContract>();
  for (const c of cats) {
    grouped.set(c.name, {
      categoryId: c.marketplaceId,
      externalId: c.externalId ?? null,
      name: c.name,
      items: [],
    });
  }
  for (const item of contractItems) {
    const match = cats.find((c) => c.marketplaceId === item.categoryId);
    if (match) {
      grouped.get(match.name)?.items.push(item);
    } else {
      const uncategorized = grouped.get("More");
      if (uncategorized) uncategorized.items.push(item);
    }
  }

  return {
    restaurant: {
      marketplaceId: restaurant.marketplaceId,
      slug: restaurant.slug,
      name: restaurant.name,
    },
    updatedSince: null,
    categories: Array.from(grouped.values()),
    itemCount: contractItems.length,
    syncedAt: new Date().toISOString(),
  };
}