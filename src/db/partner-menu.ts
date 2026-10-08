import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationRecords,
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  restaurants,
} from "@/db/schema";
import { DEFAULT_DISH_IMAGE, sanitizeImageUrl } from "@/lib/domain";
import type {
  PartnerMenuDto,
  PartnerMenuItemDto,
  PartnerModifierGroupDto,
  PartnerModifierOptionDto,
} from "@/lib/types";

/**
 * Partner-authored menu editing.
 *
 * Two rules govern every function in this file:
 *
 *  1. The restaurant is resolved from the caller's session id, never from the
 *     request. Every statement is scoped by that resolved id, so a partner can only
 *     ever reach their own rows even if they guess another tenant's item id.
 *  2. Partner rows carry POS columns that can never collide with a real POS.
 *     `modifier_groups.pos_group_id` and `modifier_options.pos_option_id` are
 *     NOT NULL, so a partner row needs a synthetic id. We mint them NEGATIVE
 *     and descending per restaurant; real POS ids are positive, and the menu
 *     webhook rejects non-positive ids (see `readPosId` in menu-sync.ts). The
 *     seed used the same trick with `9000 + n`, so partner rows (negative) and
 *     seeded rows (9000+) never fight over the same unique key.
 *
 * Partner rows and POS-synced rows coexist by design: the POS upserts only on
 * `(restaurantId, posItemId)` / `(restaurantId, posCategoryId)` /
 * `(restaurantId, posGroupId)` / `(groupId, posOptionId)`, and partner rows
 * leave `posItemId` NULL, so the two sources never fight over the same row.
 */

export type PartnerMenuFailure = { ok: false; error: string };

const LIMITS = {
  name: 80,
  category: 60,
  description: 240,
  groupName: 60,
  optionName: 60,
  priceCentsMax: 1_000_000,
  selectMax: 20,
  optionsPerGroup: 30,
} as const;

/* ------------------------------- validation ------------------------------- */

class Invalid extends Error {}

function text(raw: unknown, field: string, max: number): string {
  const value = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!value) throw new Invalid(`${field} is required`);
  if (value.length > max) throw new Invalid(`${field} must be ${max} characters or fewer`);
  return value;
}

function optionalText(raw: unknown, max: number): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function intInRange(raw: unknown, field: string, min: number, max: number): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(value)) throw new Invalid(`${field} must be a whole number`);
  if (value < min || value > max) {
    throw new Invalid(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function flag(raw: unknown): boolean {
  return Boolean(raw);
}

/* ------------------------------ id allocation ----------------------------- */

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reserve the next free negative id for a restaurant's modifier groups.
 * Takes a row lock on the restaurant first so two concurrent creates cannot
 * compute the same value.
 */
async function nextGroupId(tx: DbTx, restaurantId: number): Promise<number> {
  await tx.execute(sql`select id from restaurants where id = ${restaurantId} for update`);
  const [row] = await tx
    .select({ lowest: sql<number | null>`min(${modifierGroups.posGroupId})` })
    .from(modifierGroups)
    .where(eq(modifierGroups.restaurantId, restaurantId));
  const lowest = row?.lowest ?? null;
  return lowest !== null && lowest < 0 ? lowest - 1 : -1;
}

/** Reserve the next free negative option id within one group. */
async function nextOptionId(tx: DbTx, groupId: number): Promise<number> {
  const [row] = await tx
    .select({ lowest: sql<number | null>`min(${modifierOptions.posOptionId})` })
    .from(modifierOptions)
    .where(eq(modifierOptions.groupId, groupId));
  const lowest = row?.lowest ?? null;
  return lowest !== null && lowest < 0 ? lowest - 1 : -1;
}

/* --------------------------------- lookup --------------------------------- */

interface OwnerRow {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
}

/**
 * Load the listing a session resolved to, or null.
 *
 * Takes an id, not a key. The tenant used to be re-derived here on every call by
 * hashing a long-lived secret the request had to carry; now it arrives as a plain
 * integer from a revocable, expiring session, and this function is just a fetch.
 *
 * The id is still never taken from the request body or a URL segment — it comes
 * from `restaurant_sessions.restaurant_id` — so the scoping below is still the
 * whole tenant boundary.
 */
async function resolveOwner(restaurantId: number): Promise<OwnerRow | null> {
  const id = Number(restaurantId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      isActive: restaurants.isActive,
    })
    .from(restaurants)
    .where(eq(restaurants.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Reachable only if a live session points at a listing that no longer exists.
 *
 * Worded as an expired sign-in rather than a bad key because that is what it now
 * is: the routes above this layer already resolved a session, so there is no owner
 * key in play to be invalid.
 */
const SESSION_REQUIRED: PartnerMenuFailure = { ok: false, error: "Sign in with your owner key" };

/** Assemble one group (with its options and usage count) for the editor. */
async function loadGroupDto(groupId: number): Promise<PartnerModifierGroupDto> {
  const [group] = await db
    .select()
    .from(modifierGroups)
    .where(eq(modifierGroups.id, groupId))
    .limit(1);
  if (!group) throw new Error(`modifier group ${groupId} disappeared`);
  const [options, [{ n }]] = await Promise.all([
    db
      .select()
      .from(modifierOptions)
      .where(eq(modifierOptions.groupId, groupId))
      .orderBy(asc(modifierOptions.id)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(menuItemModifierGroups)
      .where(eq(menuItemModifierGroups.modifierGroupId, groupId)),
  ]);
  return {
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    isActive: group.isActive,
    options: options.map((o) => ({
      id: o.id,
      name: o.name,
      priceCents: o.priceCents,
      isVeg: o.isVeg,
      available: o.available,
      posSynced: o.posOptionId > 0,
    })),
    itemCount: Number(n ?? 0),
    posSynced: group.posGroupId > 0,
  };
}

/* ---------------------------------- read ---------------------------------- */

export async function getPartnerMenu(restaurantId: number): Promise<PartnerMenuDto | null> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return null;

  const [rows, groups, options, links, integration] = await Promise.all([
    db
      .select()
      .from(menuItems)
      .where(eq(menuItems.restaurantId, owner.id))
      .orderBy(asc(menuItems.sort), asc(menuItems.id)),
    db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.restaurantId, owner.id))
      .orderBy(asc(modifierGroups.id)),
    db
      .select()
      .from(modifierOptions)
      .where(eq(modifierOptions.restaurantId, owner.id))
      .orderBy(asc(modifierOptions.id)),
    db
      .select()
      .from(menuItemModifierGroups)
      .where(eq(menuItemModifierGroups.restaurantId, owner.id)),
    db
      .select({ id: integrationRecords.id })
      .from(integrationRecords)
      .where(eq(integrationRecords.restaurantId, owner.id))
      .limit(1),
  ]);

  const optionsByGroup = new Map<number, PartnerModifierOptionDto[]>();
  for (const o of options) {
    const list = optionsByGroup.get(o.groupId) ?? [];
    list.push({
      id: o.id,
      name: o.name,
      priceCents: o.priceCents,
      isVeg: o.isVeg,
      available: o.available,
      posSynced: o.posOptionId > 0,
    });
    optionsByGroup.set(o.groupId, list);
  }

  const groupIdsByItem = new Map<number, number[]>();
  const itemCountByGroup = new Map<number, number>();
  for (const link of links) {
    const list = groupIdsByItem.get(link.menuItemId) ?? [];
    list.push(link.modifierGroupId);
    groupIdsByItem.set(link.menuItemId, list);
    itemCountByGroup.set(
      link.modifierGroupId,
      (itemCountByGroup.get(link.modifierGroupId) ?? 0) + 1,
    );
  }

  const groupsDto: PartnerModifierGroupDto[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    isActive: g.isActive,
    options: optionsByGroup.get(g.id) ?? [],
    itemCount: itemCountByGroup.get(g.id) ?? 0,
    posSynced: g.posGroupId > 0,
  }));

  const itemsDto: PartnerMenuItemDto[] = rows.map((m) => ({
    id: m.id,
    category: m.category,
    name: m.name,
    description: m.description,
    priceCents: m.priceCents,
    imageUrl: m.imageUrl,
    isVeg: m.isVeg,
    isBestseller: m.isBestseller,
    available: m.available,
    sort: m.sort,
    modifierGroupIds: groupIdsByItem.get(m.id) ?? [],
    posSynced: m.posItemId !== null,
  }));

  return {
    restaurant: { ...owner, posConnected: integration.length > 0 },
    items: itemsDto,
    modifierGroups: groupsDto,
  };
}

/* --------------------------------- dishes --------------------------------- */

/**
 * Raw request shape for a dish. Every field is `unknown` on purpose: the
 * validators below own coercion, and create/PATCH both accept the same type.
 */
export interface MenuItemInput {
  category?: unknown;
  name?: unknown;
  description?: unknown;
  priceCents?: unknown;
  imageUrl?: unknown;
  isVeg?: unknown;
  isBestseller?: unknown;
  available?: unknown;
  sort?: unknown;
}

function parseItemInput(input: MenuItemInput) {
  return {
    category: text(input.category, "Category", LIMITS.category),
    name: text(input.name, "Dish name", LIMITS.name),
    description: optionalText(input.description, LIMITS.description),
    priceCents: intInRange(input.priceCents, "Price", 0, LIMITS.priceCentsMax),
    imageUrl: sanitizeImageUrl(input.imageUrl, DEFAULT_DISH_IMAGE),
    isVeg: flag(input.isVeg),
    isBestseller: flag(input.isBestseller),
    available: input.available === undefined ? true : flag(input.available),
    sort: intInRange(input.sort ?? 0, "Sort order", 0, 10_000),
  };
}

export async function createMenuItem(
  restaurantId: number,
  input: MenuItemInput,
): Promise<{ ok: true; item: PartnerMenuItemDto } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;
  let parsed: ReturnType<typeof parseItemInput>;
  try {
    parsed = parseItemInput(input);
  } catch (e) {
    return { ok: false, error: e instanceof Invalid ? e.message : "Invalid dish" };
  }

  try {
    const [row] = await db
      .insert(menuItems)
      .values({
        restaurantId: owner.id,
        category: parsed.category,
        name: parsed.name,
        description: parsed.description,
        priceCents: parsed.priceCents,
        imageUrl: parsed.imageUrl,
        isVeg: parsed.isVeg,
        isBestseller: parsed.isBestseller,
        available: parsed.available,
        sort: parsed.sort,
        // POS identity columns stay NULL: this row is partner-owned, so a POS
        // sync can never match or overwrite it.
        posItemId: null,
        posCategoryId: null,
        categoryId: null,
        lastSyncedAt: null,
      })
      .returning();
    return {
      ok: true,
      item: {
        id: row.id,
        category: row.category,
        name: row.name,
        description: row.description,
        priceCents: row.priceCents,
        imageUrl: row.imageUrl,
        isVeg: row.isVeg,
        isBestseller: row.isBestseller,
        available: row.available,
        sort: row.sort,
        modifierGroupIds: [],
        posSynced: false,
      },
    };
  } catch {
    return { ok: false, error: "Could not save the dish" };
  }
}

/** Load one dish, scoped to the owner — the tenant boundary for every edit. */
async function ownedItem(ownerId: number, itemId: number) {
  const id = Number(itemId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function updateMenuItem(
  restaurantId: number,
  itemId: number,
  patch: MenuItemInput,
): Promise<{ ok: true; item: PartnerMenuItemDto } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;
  const existing = await ownedItem(owner.id, itemId);
  if (!existing) return { ok: false, error: "Dish not found" };

  // Merge over the stored row so a PATCH only needs the fields it changes.
  let parsed: ReturnType<typeof parseItemInput>;
  try {
    parsed = parseItemInput({
      category: patch.category ?? existing.category,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      priceCents: patch.priceCents ?? existing.priceCents,
      imageUrl: patch.imageUrl ?? existing.imageUrl,
      isVeg: patch.isVeg ?? existing.isVeg,
      isBestseller: patch.isBestseller ?? existing.isBestseller,
      available: patch.available ?? existing.available,
      sort: patch.sort ?? existing.sort,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Invalid ? e.message : "Invalid dish" };
  }

  try {
    const [row] = await db
      .update(menuItems)
      .set(parsed)
      .where(and(eq(menuItems.id, existing.id), eq(menuItems.restaurantId, owner.id)))
      .returning();
    const links = await db
      .select({ groupId: menuItemModifierGroups.modifierGroupId })
      .from(menuItemModifierGroups)
      .where(eq(menuItemModifierGroups.menuItemId, existing.id));
    return {
      ok: true,
      item: {
        id: row.id,
        category: row.category,
        name: row.name,
        description: row.description,
        priceCents: row.priceCents,
        imageUrl: row.imageUrl,
        isVeg: row.isVeg,
        isBestseller: row.isBestseller,
        available: row.available,
        sort: row.sort,
        modifierGroupIds: links.map((l) => l.groupId),
        posSynced: row.posItemId !== null,
      },
    };
  } catch {
    return { ok: false, error: "Could not update the dish" };
  }
}

export async function deleteMenuItem(
  restaurantId: number,
  itemId: number,
): Promise<{ ok: true } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;
  const existing = await ownedItem(owner.id, itemId);
  if (!existing) return { ok: false, error: "Dish not found" };
  // menu_item_modifier_groups cascade on the item, so attachments go with it.
  await db
    .delete(menuItems)
    .where(and(eq(menuItems.id, existing.id), eq(menuItems.restaurantId, owner.id)));
  return { ok: true };
}

/* ----------------------------- dish <-> group ----------------------------- */

export async function linkModifierGroup(
  restaurantId: number,
  itemId: number,
  groupId: unknown,
): Promise<{ ok: true } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;
  const item = await ownedItem(owner.id, itemId);
  if (!item) return { ok: false, error: "Dish not found" };

  const gid = intInRange(Number(groupId), "Modifier group", 1, 2_147_483_647);
  const [group] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, gid), eq(modifierGroups.restaurantId, owner.id)))
    .limit(1);
  if (!group) return { ok: false, error: "Modifier group not found" };

  // Idempotent: the link table has a unique (menuItemId, modifierGroupId) index.
  await db
    .insert(menuItemModifierGroups)
    .values({ menuItemId: item.id, modifierGroupId: group.id, restaurantId: owner.id })
    .onConflictDoNothing();
  return { ok: true };
}

export async function unlinkModifierGroup(
  restaurantId: number,
  itemId: number,
  groupId: number,
): Promise<{ ok: true } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;
  const item = await ownedItem(owner.id, itemId);
  if (!item) return { ok: false, error: "Dish not found" };
  await db
    .delete(menuItemModifierGroups)
    .where(
      and(
        eq(menuItemModifierGroups.menuItemId, item.id),
        eq(menuItemModifierGroups.modifierGroupId, Number(groupId)),
        eq(menuItemModifierGroups.restaurantId, owner.id),
      ),
    );
  return { ok: true };
}

/* ----------------------------- modifier groups ---------------------------- */

export interface ModifierOptionInput {
  id?: unknown;
  name: unknown;
  priceCents?: unknown;
  isVeg?: unknown;
  available?: unknown;
}

export interface ModifierGroupInput {
  name?: unknown;
  minSelect?: unknown;
  maxSelect?: unknown;
  isActive?: unknown;
  options?: unknown;
}

function parseOptions(raw: unknown): Array<{
  id: number | null;
  name: string;
  priceCents: number;
  isVeg: boolean;
  available: boolean;
}> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Invalid("Options must be a list");
  if (raw.length > LIMITS.optionsPerGroup) {
    throw new Invalid(`A group can hold at most ${LIMITS.optionsPerGroup} options`);
  }
  return raw.map((entry) => {
    const o = (entry ?? {}) as ModifierOptionInput;
    const id = o.id === undefined || o.id === null ? null : Number(o.id);
    if (id !== null && !Number.isInteger(id)) throw new Invalid("Option id must be a whole number");
    return {
      id,
      name: text(o.name, "Option name", LIMITS.optionName),
      priceCents: intInRange(o.priceCents ?? 0, "Option price", 0, LIMITS.priceCentsMax),
      isVeg: o.isVeg === undefined ? true : flag(o.isVeg),
      available: o.available === undefined ? true : flag(o.available),
    };
  });
}

function parseBounds(min: unknown, max: unknown): { minSelect: number; maxSelect: number } {
  const minSelect = intInRange(min ?? 0, "Minimum selections", 0, LIMITS.selectMax);
  const maxSelect = intInRange(max ?? 1, "Maximum selections", 1, LIMITS.selectMax);
  // computeBill enforces exactly this, so a group the editor accepts can never
  // be a group checkout rejects.
  if (maxSelect < minSelect) throw new Invalid("Maximum selections must be at least the minimum");
  return { minSelect, maxSelect };
}

export async function createModifierGroup(
  restaurantId: number,
  input: ModifierGroupInput,
): Promise<{ ok: true; group: PartnerModifierGroupDto } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;

  let name: string;
  let bounds: { minSelect: number; maxSelect: number };
  let options: ReturnType<typeof parseOptions>;
  try {
    name = text(input.name, "Group name", LIMITS.groupName);
    bounds = parseBounds(input.minSelect, input.maxSelect);
    options = parseOptions(input.options);
    if (!options.length) throw new Invalid("Add at least one option");
  } catch (e) {
    return { ok: false, error: e instanceof Invalid ? e.message : "Invalid modifier group" };
  }

  try {
    const group = await db.transaction(async (tx) => {
      const posGroupId = await nextGroupId(tx, owner.id);
      const [row] = await tx
        .insert(modifierGroups)
        .values({
          restaurantId: owner.id,
          posGroupId,
          name,
          minSelect: bounds.minSelect,
          maxSelect: bounds.maxSelect,
          isActive: input.isActive === undefined ? true : flag(input.isActive),
          lastSyncedAt: null,
        })
        .returning();

      // Options are inserted one at a time so each gets its own reserved id
      // from the group-local counter.
      for (const o of options) {
        await tx.insert(modifierOptions).values({
          groupId: row.id,
          restaurantId: owner.id,
          posGroupId,
          posOptionId: await nextOptionId(tx, row.id),
          name: o.name,
          priceCents: o.priceCents,
          isVeg: o.isVeg,
          available: o.available,
          lastSyncedAt: null,
        });
      }
      return row;
    });

    return { ok: true, group: await loadGroupDto(group.id) };
  } catch {
    return { ok: false, error: "Could not save the modifier group" };
  }
}

export async function updateModifierGroup(
  restaurantId: number,
  groupId: number,
  patch: ModifierGroupInput,
): Promise<{ ok: true; group: PartnerModifierGroupDto } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;
  const id = Number(groupId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Modifier group not found" };

  const [existing] = await db
    .select()
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, id), eq(modifierGroups.restaurantId, owner.id)))
    .limit(1);
  if (!existing) return { ok: false, error: "Modifier group not found" };

  let bounds: { minSelect: number; maxSelect: number };
  let name: string;
  let options: ReturnType<typeof parseOptions> | null = null;
  try {
    name = patch.name === undefined ? existing.name : text(patch.name, "Group name", LIMITS.groupName);
    bounds = parseBounds(patch.minSelect ?? existing.minSelect, patch.maxSelect ?? existing.maxSelect);
    options = patch.options === undefined ? null : parseOptions(patch.options);
  } catch (e) {
    return { ok: false, error: e instanceof Invalid ? e.message : "Invalid modifier group" };
  }

  try {
    const group = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(modifierGroups)
        .set({
          name,
          minSelect: bounds.minSelect,
          maxSelect: bounds.maxSelect,
          isActive: patch.isActive === undefined ? existing.isActive : flag(patch.isActive),
        })
        .where(eq(modifierGroups.id, existing.id))
        .returning();

      if (options) {
        // Full replacement of the option set. Safe because orders store item
        // snapshots (orders.items jsonb), so removing an option never rewrites
        // order history. Options the editor echoes back keep their ids.
        const keepIds = options.filter((o) => o.id !== null).map((o) => o.id as number);
        const current = await tx
          .select({ id: modifierOptions.id })
          .from(modifierOptions)
          .where(eq(modifierOptions.groupId, existing.id));
        const currentIds = new Set(current.map((c) => c.id));
        const drop = currentIds.size > 0 ? [...currentIds].filter((cid) => !keepIds.includes(cid)) : [];
        if (drop.length) {
          await tx
            .delete(modifierOptions)
            .where(and(eq(modifierOptions.groupId, existing.id), inArray(modifierOptions.id, drop)));
        }
        for (const o of options) {
          if (o.id !== null && currentIds.has(o.id)) {
            await tx
              .update(modifierOptions)
              .set({
                name: o.name,
                priceCents: o.priceCents,
                isVeg: o.isVeg,
                available: o.available,
              })
              .where(and(eq(modifierOptions.id, o.id), eq(modifierOptions.groupId, existing.id)));
          } else {
            const posOptionId = await nextOptionId(tx, existing.id);
            await tx.insert(modifierOptions).values({
              groupId: existing.id,
              restaurantId: owner.id,
              posGroupId: existing.posGroupId,
              posOptionId,
              name: o.name,
              priceCents: o.priceCents,
              isVeg: o.isVeg,
              available: o.available,
              lastSyncedAt: null,
            });
          }
        }
      }
      return row;
    });

    return { ok: true, group: await loadGroupDto(group.id) };
  } catch {
    return { ok: false, error: "Could not update the modifier group" };
  }
}
export async function deleteModifierGroup(
  restaurantId: number,
  groupId: number,
): Promise<{ ok: true } | PartnerMenuFailure> {
  const owner = await resolveOwner(restaurantId);
  if (!owner) return SESSION_REQUIRED;
  const id = Number(groupId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Modifier group not found" };
  const [existing] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, id), eq(modifierGroups.restaurantId, owner.id)))
    .limit(1);
  if (!existing) return { ok: false, error: "Modifier group not found" };
  // Options and dish links both cascade from the group.
  await db
    .delete(modifierGroups)
    .where(and(eq(modifierGroups.id, existing.id), eq(modifierGroups.restaurantId, owner.id)));
  return { ok: true };
}
