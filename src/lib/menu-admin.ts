import { db } from "@/db";
import {
  restaurants,
  menus,
  categories,
  menuItems,
  menuItemModifierGroups,
  menuItemModifiers,
} from "@/db/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import { categoryId, menuItemId, menuId, num } from "./format";
import { cleanExternalId } from "./external-map";

/**
 * Owner-side menu authoring.
 *
 * Writes go straight into the shared POS tables (`categories`, `menu_items`,
 * `menu_item_modifier_groups`, `menu_item_modifiers`) that the public
 * storefront, search, photos and ordering already read from. There is no
 * second "marketplace menu" — this is the same single source of truth.
 *
 * Every mutation is scoped to the restaurant id resolved from the slug, and
 * every row touched is re-checked against that id, so an authenticated admin
 * can never edit another restaurant's menu by guessing an id.
 */

export type EditorItem = {
  id: number;
  marketplaceId: string;
  /** PHASE 35 — external RestaurantAI/POS id ("pos_item_…") if mapped. */
  externalId: string | null;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isAvailable: boolean;
  isPopular: boolean;
  isVegetarian: boolean;
  categoryId: number | null;
  modifierGroups: EditorModifierGroup[];
};

export type EditorModifierGroup = {
  id: number;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  modifiers: EditorModifier[];
};

export type EditorModifier = {
  id: number;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
  sortOrder: number;
};

export type EditorCategory = {
  id: number;
  marketplaceId: string;
  /** PHASE 35 — external RestaurantAI/POS id ("pos_cat_…") if mapped. */
  externalId: string | null;
  name: string;
  sortOrder: number;
  items: EditorItem[];
};

export type EditorMenu = {
  restaurant: { id: number; slug: string; name: string };
  categories: EditorCategory[];
};

async function resolveRestaurantId(slug: string) {
  const [r] = await db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  return r ?? null;
}

export async function getEditorMenu(slug: string): Promise<EditorMenu | null> {
  const r = await resolveRestaurantId(slug);
  if (!r) return null;

  const [cats, items, groups, mods] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.restaurantId, r.id))
      .orderBy(asc(categories.sortOrder), asc(categories.id)),
    db
      .select()
      .from(menuItems)
      .where(eq(menuItems.restaurantId, r.id))
      .orderBy(asc(menuItems.id)),
    db
      .select({
        id: menuItemModifierGroups.id,
        menuItemId: menuItemModifierGroups.menuItemId,
        name: menuItemModifierGroups.name,
        minSelect: menuItemModifierGroups.minSelect,
        maxSelect: menuItemModifierGroups.maxSelect,
        sortOrder: menuItemModifierGroups.sortOrder,
      })
      .from(menuItemModifierGroups)
      .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
      .where(eq(menuItems.restaurantId, r.id))
      .orderBy(
        asc(menuItemModifierGroups.sortOrder),
        asc(menuItemModifierGroups.id),
      ),
    db
      .select({
        id: menuItemModifiers.id,
        groupId: menuItemModifiers.groupId,
        name: menuItemModifiers.name,
        priceDelta: menuItemModifiers.priceDelta,
        isAvailable: menuItemModifiers.isAvailable,
        sortOrder: menuItemModifiers.sortOrder,
      })
      .from(menuItemModifiers)
      .innerJoin(
        menuItemModifierGroups,
        eq(menuItemModifierGroups.id, menuItemModifiers.groupId),
      )
      .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
      .where(eq(menuItems.restaurantId, r.id)),
  ]);

  const groupsByItem = new Map<number, EditorModifierGroup[]>();
  const modsByGroup = new Map<number, EditorModifier[]>();
  for (const row of mods) {
    const list = modsByGroup.get(row.groupId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      priceDelta: num(row.priceDelta),
      isAvailable: row.isAvailable,
      sortOrder: row.sortOrder,
    });
    modsByGroup.set(row.groupId, list);
  }
  for (const g of groups) {
    const list = groupsByItem.get(g.menuItemId) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sortOrder: g.sortOrder,
      modifiers: modsByGroup.get(g.id) ?? [],
    });
    groupsByItem.set(g.menuItemId, list);
  }

  const grouped = new Map<number, EditorItem[]>();
  for (const i of items) {
    const list = grouped.get(i.categoryId ?? -1) ?? [];
    list.push({
      id: i.id,
      marketplaceId: i.marketplaceId,
      externalId: i.externalId ?? null,
      name: i.name,
      description: i.description,
      price: num(i.price),
      imageUrl: i.imageUrl,
      isAvailable: i.isAvailable,
      isPopular: i.isPopular,
      isVegetarian: i.isVegetarian,
      categoryId: i.categoryId,
      modifierGroups: groupsByItem.get(i.id) ?? [],
    });
    grouped.set(i.categoryId ?? -1, list);
  }

  const uncategorised = grouped.get(-1) ?? [];

  return {
    restaurant: { id: r.id, slug: r.slug, name: r.name },
    categories: [
      ...cats.map((c) => ({
        id: c.id,
        marketplaceId: c.marketplaceId,
        externalId: c.externalId ?? null,
        name: c.name,
        sortOrder: c.sortOrder,
        items: grouped.get(c.id) ?? [],
      })),
      ...(uncategorised.length
        ? [{ id: -1, marketplaceId: "", externalId: null, name: "Uncategorised", sortOrder: 9999, items: uncategorised }]
        : []),
    ],
  };
}

/**
 * Returns the restaurant's default menu id, creating the default menu row on
 * first use (for restaurants created before menus existed) so categories and
 * items always attach to a concrete menu container.
 */
async function ensureDefaultMenu(restaurantId: number): Promise<number> {
  const [row] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(
      and(eq(menus.restaurantId, restaurantId), eq(menus.isDefault, true)),
    )
    .limit(1);
  if (row) return row.id;

  const [created] = await db
    .insert(menus)
    .values({
      restaurantId,
      name: "Menu",
      isDefault: true,
      marketplaceId: menuId(),
    })
    .returning({ id: menus.id });
  return created.id;
}

/** Returns the id of an owned row, else null. Enforces restaurant scoping. */
async function ownedCategory(restaurantId: number, categoryId: number) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(eq(categories.id, categoryId), eq(categories.restaurantId, restaurantId)),
    )
    .limit(1);
  return row?.id ?? null;
}

async function ownedItem(restaurantId: number, itemId: number) {
  const [row] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(
      and(eq(menuItems.id, itemId), eq(menuItems.restaurantId, restaurantId)),
    )
    .limit(1);
  return row?.id ?? null;
}

async function ownedGroup(restaurantId: number, groupId: number) {
  const [row] = await db
    .select({ id: menuItemModifierGroups.id })
    .from(menuItemModifierGroups)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
    .where(
      and(
        eq(menuItemModifierGroups.id, groupId),
        eq(menuItems.restaurantId, restaurantId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function ownedModifier(restaurantId: number, modifierId: number) {
  const [row] = await db
    .select({ id: menuItemModifiers.id })
    .from(menuItemModifiers)
    .innerJoin(
      menuItemModifierGroups,
      eq(menuItemModifierGroups.id, menuItemModifiers.groupId),
    )
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
    .where(
      and(
        eq(menuItemModifiers.id, modifierId),
        eq(menuItems.restaurantId, restaurantId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

async function checkItemCategory(restaurantId: number, categoryId: number | null) {
  if (categoryId === null) return true;
  return (await ownedCategory(restaurantId, categoryId)) !== null;
}

export async function addCategory(
  slug: string,
  name: string,
): Promise<ActionResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Category name is required" };
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  const existing = await db
    .select({ sortOrder: categories.sortOrder })
    .from(categories)
    .where(eq(categories.restaurantId, r.id))
    .orderBy(asc(categories.sortOrder));
  const sortOrder =
    (existing.length ? Math.max(...existing.map((c) => c.sortOrder)) : -1) + 1;
  const defaultMenuId = await ensureDefaultMenu(r.id);

  await db
    .insert(categories)
    .values({
      restaurantId: r.id,
      menuId: defaultMenuId,
      marketplaceId: categoryId(),
      name: clean.slice(0, 120),
      sortOrder,
    });
  return { ok: true };
}

export async function addItem(
  slug: string,
  input: {
    name: string;
    price: number;
    categoryId?: number | null;
    description?: string;
    imageUrl?: string;
    isAvailable?: boolean;
    isPopular?: boolean;
    isVegetarian?: boolean;
  },
): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Item name is required" };
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, error: "Price must be a positive number" };
  }
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  const categoryIdInput =
    input.categoryId && input.categoryId > 0 ? input.categoryId : null;
  if (!(await checkItemCategory(r.id, categoryIdInput))) {
    return { ok: false, error: "Category does not belong to this restaurant" };
  }

  // Attach the item to its category's menu container (falling back to the
  // restaurant's default menu) so the hierarchy stays complete.
  let menuIdValue: number | null = null;
  if (categoryIdInput) {
    const [catRow] = await db
      .select({ menuId: categories.menuId })
      .from(categories)
      .where(
        and(eq(categories.id, categoryIdInput), eq(categories.restaurantId, r.id)),
      )
      .limit(1);
    menuIdValue = catRow?.menuId ?? null;
  }
  menuIdValue ??= await ensureDefaultMenu(r.id);

  await db.insert(menuItems).values({
    restaurantId: r.id,
    categoryId: categoryIdInput,
    menuId: menuIdValue,
    marketplaceId: menuItemId(),
    name: name.slice(0, 160),
    description: (input.description ?? "").trim().slice(0, 2000),
    price: price.toFixed(2),
    imageUrl: (input.imageUrl ?? "").trim(),
    isAvailable: input.isAvailable ?? true,
    isPopular: input.isPopular ?? false,
    isVegetarian: input.isVegetarian ?? false,
  });
  return { ok: true };
}

export async function addGroup(
  slug: string,
  menuItemId: number,
  name: string,
  minSelect: number,
  maxSelect: number,
): Promise<ActionResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Option group name is required" };
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedItem(r.id, menuItemId))) {
    return { ok: false, error: "Item does not belong to this restaurant" };
  }
  const sorted = Number.isFinite(minSelect) ? Math.max(0, Math.floor(minSelect)) : 0;
  const max = Number.isFinite(maxSelect) ? Math.max(0, Math.floor(maxSelect)) : 1;

  const existing = await db
    .select({ sortOrder: menuItemModifierGroups.sortOrder })
    .from(menuItemModifierGroups)
    .where(eq(menuItemModifierGroups.menuItemId, menuItemId))
    .orderBy(asc(menuItemModifierGroups.sortOrder));
  const sortOrder =
    (existing.length ? Math.max(...existing.map((g) => g.sortOrder)) : -1) + 1;

  await db.insert(menuItemModifierGroups).values({
    menuItemId,
    name: clean.slice(0, 120),
    minSelect: sorted,
    maxSelect: max,
    sortOrder,
  });
  return { ok: true };
}

export async function addModifier(
  slug: string,
  groupId: number,
  name: string,
  priceDelta: number,
): Promise<ActionResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Modifier name is required" };
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedGroup(r.id, groupId))) {
    return { ok: false, error: "Option group does not belong to this restaurant" };
  }
  const delta = Number.isFinite(priceDelta) ? priceDelta : 0;
  const existing = await db
    .select({ sortOrder: menuItemModifiers.sortOrder })
    .from(menuItemModifiers)
    .where(eq(menuItemModifiers.groupId, groupId))
    .orderBy(asc(menuItemModifiers.sortOrder));
  const sortOrder =
    (existing.length ? Math.max(...existing.map((m) => m.sortOrder)) : -1) + 1;

  await db.insert(menuItemModifiers).values({
    groupId,
    name: clean.slice(0, 120),
    priceDelta: delta.toFixed(2),
    isAvailable: true,
    sortOrder,
  });
  return { ok: true };
}

export async function updateCategory(
  slug: string,
  categoryId: number,
  patch: { name?: string; sortOrder?: number; externalId?: string | null },
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedCategory(r.id, categoryId))) {
    return { ok: false, error: "Category does not belong to this restaurant" };
  }
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim();
    if (!clean) return { ok: false, error: "Category name is required" };
    set.name = clean.slice(0, 120);
  }
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    set.sortOrder = Math.floor(patch.sortOrder);
  }
  if (patch.externalId !== undefined) {
    const ext = cleanExternalId(patch.externalId);
    if (ext) {
      const hit = await db
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.restaurantId, r.id),
            eq(categories.externalId, ext),
            ne(categories.id, categoryId),
          ),
        )
        .limit(1);
      if (hit.length > 0) {
        return {
          ok: false,
          error: `External id "${ext}" is already mapped to another category`,
        };
      }
    }
    set.externalId = ext ?? null;
  }
  await db
    .update(categories)
    .set(set as never)
    .where(eq(categories.id, categoryId));
  return { ok: true };
}

export async function updateItem(
  slug: string,
  itemId: number,
  patch: {
    name?: string;
    price?: number;
    categoryId?: number | null;
    description?: string;
    imageUrl?: string;
    isAvailable?: boolean;
    isPopular?: boolean;
    isVegetarian?: boolean;
    externalId?: string | null;
  },
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedItem(r.id, itemId))) {
    return { ok: false, error: "Item does not belong to this restaurant" };
  }
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim();
    if (!clean) return { ok: false, error: "Item name is required" };
    set.name = clean.slice(0, 160);
  }
  if (patch.price !== undefined) {
    const price = Number(patch.price);
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: "Price must be a positive number" };
    }
    set.price = price.toFixed(2);
  }
  if (patch.categoryId !== undefined) {
    const categoryId =
      patch.categoryId && patch.categoryId > 0 ? patch.categoryId : null;
    if (!(await checkItemCategory(r.id, categoryId))) {
      return { ok: false, error: "Category does not belong to this restaurant" };
    }
    set.categoryId = categoryId;
  }
  if (patch.description !== undefined) {
    set.description = patch.description.trim().slice(0, 2000);
  }
  if (patch.imageUrl !== undefined) set.imageUrl = patch.imageUrl.trim();
  if (patch.isAvailable !== undefined) set.isAvailable = Boolean(patch.isAvailable);
  if (patch.isPopular !== undefined) set.isPopular = Boolean(patch.isPopular);
  if (patch.isVegetarian !== undefined) set.isVegetarian = Boolean(patch.isVegetarian);
  if (patch.externalId !== undefined) {
    const ext = cleanExternalId(patch.externalId);
    if (ext) {
      const hit = await db
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.restaurantId, r.id),
            eq(menuItems.externalId, ext),
            ne(menuItems.id, itemId),
          ),
        )
        .limit(1);
      if (hit.length > 0) {
        return {
          ok: false,
          error: `External id "${ext}" is already mapped to another item`,
        };
      }
    }
    set.externalId = ext ?? null;
  }
  await db
    .update(menuItems)
    .set(set as never)
    .where(eq(menuItems.id, itemId));
  return { ok: true };
}

export async function updateGroup(
  slug: string,
  groupId: number,
  patch: {
    name?: string;
    minSelect?: number;
    maxSelect?: number;
    sortOrder?: number;
  },
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedGroup(r.id, groupId))) {
    return { ok: false, error: "Option group does not belong to this restaurant" };
  }
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim();
    if (!clean) return { ok: false, error: "Option group name is required" };
    set.name = clean.slice(0, 120);
  }
  if (patch.minSelect !== undefined) {
    set.minSelect = Math.max(0, Math.floor(Number(patch.minSelect)));
  }
  if (patch.maxSelect !== undefined) {
    set.maxSelect = Math.max(0, Math.floor(Number(patch.maxSelect)));
  }
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    set.sortOrder = Math.floor(patch.sortOrder);
  }
  await db
    .update(menuItemModifierGroups)
    .set(set as never)
    .where(eq(menuItemModifierGroups.id, groupId));
  return { ok: true };
}

export async function updateModifier(
  slug: string,
  modifierId: number,
  patch: {
    name?: string;
    priceDelta?: number;
    isAvailable?: boolean;
    sortOrder?: number;
  },
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedModifier(r.id, modifierId))) {
    return { ok: false, error: "Modifier does not belong to this restaurant" };
  }
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim();
    if (!clean) return { ok: false, error: "Modifier name is required" };
    set.name = clean.slice(0, 120);
  }
  if (patch.priceDelta !== undefined) {
    set.priceDelta = Number(patch.priceDelta).toFixed(2);
  }
  if (patch.isAvailable !== undefined) set.isAvailable = Boolean(patch.isAvailable);
  if (patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder)) {
    set.sortOrder = Math.floor(patch.sortOrder);
  }
  await db
    .update(menuItemModifiers)
    .set(set as never)
    .where(eq(menuItemModifiers.id, modifierId));
  return { ok: true };
}

export async function deleteCategory(
  slug: string,
  categoryId: number,
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedCategory(r.id, categoryId))) {
    return { ok: false, error: "Category does not belong to this restaurant" };
  }
  await db.delete(categories).where(eq(categories.id, categoryId));
  return { ok: true };
}

export async function deleteItem(
  slug: string,
  itemId: number,
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedItem(r.id, itemId))) {
    return { ok: false, error: "Item does not belong to this restaurant" };
  }
  await db.delete(menuItems).where(eq(menuItems.id, itemId));
  return { ok: true };
}

export async function deleteGroup(
  slug: string,
  groupId: number,
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedGroup(r.id, groupId))) {
    return { ok: false, error: "Option group does not belong to this restaurant" };
  }
  await db.delete(menuItemModifierGroups).where(eq(menuItemModifierGroups.id, groupId));
  return { ok: true };
}

export async function deleteModifier(
  slug: string,
  modifierId: number,
): Promise<ActionResult> {
  const r = await resolveRestaurantId(slug);
  if (!r) return { ok: false, error: "Restaurant not found" };
  if (!(await ownedModifier(r.id, modifierId))) {
    return { ok: false, error: "Modifier does not belong to this restaurant" };
  }
  await db.delete(menuItemModifiers).where(eq(menuItemModifiers.id, modifierId));
  return { ok: true };
}
