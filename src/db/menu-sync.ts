import { and, eq, max } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationRecords,
  menuCategories,
  menuItemModifierGroups,
  menuItems,
  menuWebhookEvents,
  modifierGroups,
  modifierOptions,
  restaurants,
  type MenuMappings,
} from "@/db/schema";

/* ----------------------------- helpers --------------------------------- */

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** POS price (numeric rupees, 10,2) → Marketplace priceCents (int paise). */
function cents(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

type JsonObject = Record<string, unknown>;

/* --------------------------- read path --------------------------------- */

/** Resolve a restaurant by its canonical public marketplace id (rst_…). */
export async function getRestaurantIdByMarketplaceId(
  marketplaceId: string,
): Promise<number | null> {
  const id = String(marketplaceId ?? "").trim();
  if (!id) return null;
  const [row] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.marketplaceId, id))
    .limit(1);
  return row?.id ?? null;
}

/** Ledger row for an already-processed event_id (dedupe path). */
export async function getMenuWebhookEvent(eventId: string) {
  const [row] = await db
    .select()
    .from(menuWebhookEvents)
    .where(eq(menuWebhookEvents.eventId, eventId))
    .limit(1);
  return row ?? null;
}

/** Fetch a minted menu item (echoed back to the POS in item event responses). */
export async function getMenuItemById(id: number): Promise<JsonObject | null> {
  const [row] = await db.select().from(menuItems).where(eq(menuItems.id, id)).limit(1);
  return row ? (row as unknown as JsonObject) : null;
}

/** Server-only webhook context for a restaurant (secret stays server-side). */
export async function getWebhookContext(restaurantId: number) {
  const [row] = await db
    .select({
      webhookSecret: integrationRecords.webhookSecret,
      latestMenuVersion: integrationRecords.latestMenuVersion,
    })
    .from(integrationRecords)
    .where(eq(integrationRecords.restaurantId, restaurantId))
    .limit(1);
  return row ?? null;
}

/** Seal-sidebook union of webhook secret + menu version for a restaurant. */
export async function setWebhookContext(
  restaurantId: number,
  sealedSecret: string | null,
  baseVersion = 1,
): Promise<void> {
  await db
    .update(integrationRecords)
    .set({
      webhookSecret: sealedSecret !== null ? sealedSecret : integrationRecords.webhookSecret,
      latestMenuVersion: baseVersion,
      updatedAt: new Date(),
    })
    .where(eq(integrationRecords.restaurantId, restaurantId));
}

/* --------------------------- apply path -------------------------------- */

export interface MenuApplyResult {
  deduplicated: boolean;
  menuVersion: number;
  mappings: MenuMappings;
  mintedEntityId: number | null;
  eventType: string;
  entityType: string;
  eventId: string;
  item: JsonObject | null;
}

const EVENT_PREFIX_ENTITY: Record<string, string> = {
  "menu.sync": "sync",
  "item.created": "item",
  "item.updated": "item",
  "item.deleted": "item",
  "category.created": "category",
  "category.updated": "category",
  "category.deleted": "category",
  "modifier_group.created": "modifier_group",
  "modifier_group.updated": "modifier_group",
  "modifier_group.deleted": "modifier_group",
  "modifier.created": "modifier",
  "modifier.updated": "modifier",
  "modifier.deleted": "modifier",
};

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Apply one POS menu webhook. Event-idempotent: the first event_id wins inside
 * the transaction; a concurrent/retried same event_id resolves to the original
 * ledger row (original minted ids, original version — never re-minted).
 */
export async function applyMenuWebhook(
  restaurantId: number,
  body: JsonObject,
): Promise<MenuApplyResult> {
  const eventType = String(body.event ?? "");
  const eventId = String(body.event_id ?? "").trim();
  if (!eventType || !eventId) {
    throw new Error("Menu webhook requires event + event_id");
  }
  const entityType = EVENT_PREFIX_ENTITY[eventType] ?? "sync";

  const result = await db.transaction(async (tx) => {
    const [agg] = await tx
      .select({ next: max(menuWebhookEvents.menuVersion) })
      .from(menuWebhookEvents)
      .where(eq(menuWebhookEvents.restaurantId, restaurantId));
    const nextVersion = (agg?.next ?? 0) + 1;

    const handled = await applyEvent(tx, restaurantId, eventType, body);

    const inserted = await tx
      .insert(menuWebhookEvents)
      .values({
        restaurantId,
        eventId,
        eventType,
        entityType,
        mappings: handled.mappings,
        mintedEntityId: handled.mintedEntityId,
        menuVersion: nextVersion,
      })
      .onConflictDoNothing({ target: menuWebhookEvents.eventId });

    if (inserted.rowCount === 0) {
      // A concurrent reducer already won this event_id → echo the original.
      const existing = await tx
        .select()
        .from(menuWebhookEvents)
        .where(eq(menuWebhookEvents.eventId, eventId))
        .limit(1);
      const row = existing[0];
      if (row) {
        return {
          deduplicated: true,
          menuVersion: row.menuVersion,
          mappings: (row.mappings ?? {}) as MenuMappings,
          mintedEntityId: row.mintedEntityId,
          eventType,
          entityType: row.entityType ?? "sync",
          eventId,
          item: null,
        };
      }
    }

    // Accepted: advance the restaurant's menu version counter.
    await tx
      .update(integrationRecords)
      .set({ latestMenuVersion: nextVersion })
      .where(eq(integrationRecords.restaurantId, restaurantId));

    return {
      deduplicated: false,
      menuVersion: nextVersion,
      mappings: handled.mappings,
      mintedEntityId: handled.mintedEntityId,
      eventType,
      entityType,
      eventId,
      item: handled.item ?? null,
    };
  });

  return result;
}

/* ---------------------- per-event application --------------------------- */

async function applyEvent(
  tx: DbTx,
  restaurantId: number,
  eventType: string,
  body: JsonObject,
): Promise<{ mappings: MenuMappings; mintedEntityId: number | null; item?: JsonObject | null }> {
  const mappings: MenuMappings = {};
  const now = new Date();

  if (eventType === "menu.sync") {
    return await applyMenuSync(tx, restaurantId, body, now);
  }

  if (eventType.startsWith("item.")) {
    return await applyItemEvent(tx, restaurantId, eventType, body, now);
  }

  if (eventType.startsWith("category.")) {
    return await applyCategoryEvent(tx, restaurantId, eventType, body, now);
  }

  if (eventType.startsWith("modifier_group.")) {
    return await applyModifierGroupEvent(tx, restaurantId, eventType, body, now);
  }

  if (eventType.startsWith("modifier.")) {
    return await applyModifierEvent(tx, restaurantId, eventType, body, now);
  }

  return { mappings, mintedEntityId: null };
}

async function applyMenuSync(
  tx: DbTx,
  restaurantId: number,
  body: JsonObject,
  now: Date,
): Promise<{ mappings: MenuMappings; mintedEntityId: null }> {
  const mappings: MenuMappings = {};
  const catIds = new Map<number, number>();

  for (const c of asArray(body.categories)) {
    const posCatId = toInt(c.pos_category_id);
    if (posCatId === null) continue;
    const name = str(c.name) ?? "Uncategorized";
    const [row] = await tx
      .select({ id: menuCategories.id })
      .from(menuCategories)
      .where(
        and(
          eq(menuCategories.restaurantId, restaurantId),
          eq(menuCategories.posCategoryId, posCatId),
        ),
      )
      .limit(1);
    let id = row?.id;
    if (id) {
      await tx
        .update(menuCategories)
        .set({
          name,
          sortOrder: toInt(c.sort_order) ?? 0,
          isActive: bool(c.is_active, true),
          lastSyncedAt: now,
        })
        .where(eq(menuCategories.id, id));
    } else {
      const [ins] = await tx
        .insert(menuCategories)
        .values({
          restaurantId,
          posCategoryId: posCatId,
          name,
          sortOrder: toInt(c.sort_order) ?? 0,
          isActive: bool(c.is_active, true),
          lastSyncedAt: now,
        })
        .returning({ id: menuCategories.id });
      id = ins?.id;
    }
    if (id !== undefined) {
      catIds.set(posCatId, id);
      (mappings.categories ??= []).push({ pos_category_id: posCatId, id, name });
    }
  }

  const itemIds = new Map<number, number>();

  for (const it of asArray(body.items)) {
    const posItemId = toInt(it.pos_item_id);
    if (posItemId === null) continue;
    const name = str(it.name) ?? "Untitled";
    const price = cents(it.price);
    const posCategoryId = toInt(it.category_id) ?? null;
    const categoryId = posCategoryId !== null ? catIds.get(posCategoryId) : undefined;
    const displayCategory = str(it.category) ?? null;

    const [row] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .where(
        and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.posItemId, posItemId)),
      )
      .limit(1);
    let id = row?.id;
    if (id) {
      await tx
        .update(menuItems)
        .set({
          name,
          priceCents: price ?? undefined,
          isVeg: bool(it.isveg, true),
          available: bool(it.available, true),
          category: displayCategory ?? undefined,
          categoryId,
          posCategoryId,
          lastSyncedAt: now,
        })
        .where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, restaurantId)));
    } else {
      const [ins] = await tx
        .insert(menuItems)
        .values({
          restaurantId,
          posItemId,
          category: displayCategory ?? "Uncategorized",
          name,
          description: typeof it.description === "string" ? it.description : "",
          priceCents: price ?? 0,
          imageUrl: str(it.image_url ?? it.img) ?? "",
          isVeg: bool(it.isveg, true),
          isBestseller: false,
          sort: toInt(it.sort) ?? 0,
          available: bool(it.available, true),
          posCategoryId,
          categoryId,
          lastSyncedAt: now,
        })
        .returning({ id: menuItems.id });
      id = ins?.id;
    }
    if (id !== undefined) {
      itemIds.set(posItemId, id);
      // marketplace_item_id is how the POS bridges order lines back to this
      // Marketplace numeric menu_items.id — never a name, never null.
      (mappings.items ??= []).push({ pos_item_id: posItemId, id, name, marketplace_item_id: String(id) });
    }
  }

  for (const g of asArray(body.modifier_groups)) {
    const posGroupId = toInt(g.pos_group_id);
    if (posGroupId === null) continue;
    const name = str(g.name) ?? "Modifiers";
    const [row] = await tx
      .select({ id: modifierGroups.id })
      .from(modifierGroups)
      .where(
        and(
          eq(modifierGroups.restaurantId, restaurantId),
          eq(modifierGroups.posGroupId, posGroupId),
        ),
      )
      .limit(1);
    let groupId = row?.id;
    if (groupId) {
      await tx
        .update(modifierGroups)
        .set({
          name,
          minSelect: toInt(g.min_select) ?? 0,
          maxSelect: toInt(g.max_select) ?? 1,
          isActive: bool(g.is_active, true),
          lastSyncedAt: now,
        })
        .where(eq(modifierGroups.id, groupId));
    } else {
      const [ins] = await tx
        .insert(modifierGroups)
        .values({
          restaurantId,
          posGroupId,
          name,
          minSelect: toInt(g.min_select) ?? 0,
          maxSelect: toInt(g.max_select) ?? 1,
          isActive: bool(g.is_active, true),
          lastSyncedAt: now,
        })
        .returning({ id: modifierGroups.id });
      groupId = ins?.id;
    }
    if (groupId === undefined) continue;
    mappings.modifier_groups = mappings.modifier_groups ?? [];
    mappings.modifier_groups.push({ pos_group_id: posGroupId, id: groupId, name });

    const linkedItems = asArray(g.items).map(Number);
    for (const posItemId of linkedItems) {
      const menuItemId = itemIds.get(Number(posItemId));
      if (menuItemId === undefined) continue;
      await tx
        .insert(menuItemModifierGroups)
        .values({
          menuItemId,
          modifierGroupId: groupId,
          restaurantId,
          lastSyncedAt: now,
        })
        .onConflictDoNothing({ target: [menuItemModifierGroups.menuItemId, menuItemModifierGroups.modifierGroupId] });
    }

    for (const md of asArray(g.modifiers)) {
      const posOptionId = toInt(md.pos_modifier_id);
      if (posOptionId === null) continue;
      const optName = str(md.name) ?? "Option";
      const price = cents(md.price);
      const [optRow] = await tx
        .select({ id: modifierOptions.id })
        .from(modifierOptions)
        .where(
          and(
            eq(modifierOptions.groupId, groupId),
            eq(modifierOptions.posOptionId, posOptionId),
          ),
        )
        .limit(1);
      let optionId = optRow?.id;
      if (optionId) {
        await tx
          .update(modifierOptions)
          .set({
            name: optName,
            priceCents: price ?? undefined,
            isVeg: bool(md.isveg, true),
            available: bool(md.available, true),
            posGroupId,
            lastSyncedAt: now,
          })
          .where(eq(modifierOptions.id, optionId));
      } else {
        const [ins] = await tx
          .insert(modifierOptions)
          .values({
            groupId,
            restaurantId,
            posGroupId,
            posOptionId,
            name: optName,
            priceCents: price ?? 0,
            isVeg: bool(md.isveg, true),
            available: bool(md.available, true),
            lastSyncedAt: now,
          })
          .returning({ id: modifierOptions.id });
        optionId = ins?.id;
      }
      if (optionId !== undefined) {
        mappings.modifiers = mappings.modifiers ?? [];
        mappings.modifiers.push({
          pos_group_id: posGroupId,
          pos_modifier_id: posOptionId,
          id: optionId,
          name: optName,
        });
      }
    }
  }

  return { mappings, mintedEntityId: null };
}

async function applyItemEvent(
  tx: DbTx,
  restaurantId: number,
  eventType: string,
  body: JsonObject,
  now: Date,
): Promise<{ mappings: MenuMappings; mintedEntityId: number | null; item?: JsonObject | null }> {
  const posItemId = toInt(body.pos_item_id);
  const marketplaceItemId = toInt(body.marketplace_item_id);
  const byPos = posItemId !== null
    ? await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(
          and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.posItemId, posItemId)),
        )
        .limit(1)
    : [];
  const byMinted = byPos.length
    ? byPos
    : marketplaceItemId !== null
      ? await tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(
            and(eq(menuItems.id, marketplaceItemId), eq(menuItems.restaurantId, restaurantId)),
          )
          .limit(1)
      : [];
  let id = byMinted[0]?.id;

  if (eventType === "item.deleted") {
    if (id) {
      await tx
        .update(menuItems)
        .set({ available: false, lastSyncedAt: now })
        .where(eq(menuItems.id, id));
    }
    return { mappings: {}, mintedEntityId: id ?? null };
  }

  const name = str(body.name) ?? "Untitled";
  const price = cents(body.price);
  const imageUrl = str(body.image_url ?? body.img) ?? null;
  const patch: Partial<typeof menuItems.$inferInsert> = {
    name,
    isVeg: bool(body.isveg, true),
    available: bool(body.available, true),
    lastSyncedAt: now,
  };
  if (price !== null) patch.priceCents = price;
  if (imageUrl !== null) patch.imageUrl = imageUrl;
  if (typeof body.description === "string") patch.description = body.description;
  if (posItemId !== null) patch.posItemId = posItemId;
  const posCategoryId = toInt(body.category_id);
  if (posCategoryId !== null) patch.posCategoryId = posCategoryId;
  const categoryName = str(body.category);
  if (categoryName !== null) patch.category = categoryName;

  if (id) {
    await tx
      .update(menuItems)
      .set(patch)
      .where(and(eq(menuItems.id, id), eq(menuItems.restaurantId, restaurantId)));
  } else {
    const [ins] = await tx
      .insert(menuItems)
      .values({
        restaurantId,
        posItemId: posItemId ?? null,
        category: categoryName ?? "Uncategorized",
        name,
        description: typeof body.description === "string" ? body.description : "",
        priceCents: price ?? 0,
        imageUrl: imageUrl ?? "",
        isVeg: bool(body.isveg, true),
        isBestseller: false,
        sort: toInt(body.sort) ?? 0,
        available: bool(body.available, true),
        posCategoryId: posCategoryId ?? null,
        lastSyncedAt: now,
      })
      .returning({ id: menuItems.id });
    id = ins?.id;
  }

  const item = id
    ? await tx.select().from(menuItems).where(eq(menuItems.id, id)).limit(1)
    : [];
  return {
    mappings: {
      items:
        id !== null && id !== undefined
          ? [{ pos_item_id: posItemId ?? 0, id, name, marketplace_item_id: String(id) }]
          : [],
    },
    mintedEntityId: id ?? null,
    item: item[0] ? (item[0] as unknown as JsonObject) : null,
  };
}

async function applyCategoryEvent(
  tx: DbTx,
  restaurantId: number,
  eventType: string,
  body: JsonObject,
  now: Date,
): Promise<{ mappings: MenuMappings; mintedEntityId: number | null }> {
  const posCategoryId = toInt(body.pos_category_id) ?? toInt(body.marketplace_category_id);
  if (posCategoryId === null) {
    return { mappings: {}, mintedEntityId: null };
  }
  const name = str(body.name) ?? "Category";
  const [row] = await tx
    .select({ id: menuCategories.id })
    .from(menuCategories)
    .where(
      and(
        eq(menuCategories.restaurantId, restaurantId),
        eq(menuCategories.posCategoryId, posCategoryId),
      ),
    )
    .limit(1);
  let id = row?.id;
  if (id) {
    const patch: Partial<typeof menuCategories.$inferInsert> = { lastSyncedAt: now };
    const patchName = str(body.name);
    if (patchName) patch.name = patchName;
    const sortOrder = toInt(body.sort_order);
    if (sortOrder !== null) patch.sortOrder = sortOrder;
    if (eventType === "category.deleted") patch.isActive = false;
    else if (typeof body.is_active === "boolean") patch.isActive = body.is_active;
    await tx.update(menuCategories).set(patch).where(eq(menuCategories.id, id));
  } else {
    const [ins] = await tx
      .insert(menuCategories)
      .values({
        restaurantId,
        posCategoryId,
        name,
        sortOrder: toInt(body.sort_order) ?? 0,
        isActive: eventType === "category.deleted" ? false : bool(body.is_active, true),
        lastSyncedAt: now,
      })
      .returning({ id: menuCategories.id });
    id = ins?.id;
  }
  return {
    mappings: {
      categories: [{ pos_category_id: posCategoryId, id: id ?? 0, name }],
    },
    mintedEntityId: id ?? null,
  };
}

async function applyModifierGroupEvent(
  tx: DbTx,
  restaurantId: number,
  eventType: string,
  body: JsonObject,
  now: Date,
): Promise<{ mappings: MenuMappings; mintedEntityId: number | null }> {
  const posGroupId = toInt(body.pos_group_id) ?? toInt(body.marketplace_modifier_group_id);
  if (posGroupId === null) {
    return { mappings: {}, mintedEntityId: null };
  }
  const name = str(body.name) ?? "Modifiers";
  const [row] = await tx
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(
      and(
        eq(modifierGroups.restaurantId, restaurantId),
        eq(modifierGroups.posGroupId, posGroupId),
      ),
    )
    .limit(1);
  let id = row?.id;
  if (id) {
    const patch: Partial<typeof modifierGroups.$inferInsert> = { lastSyncedAt: now };
    const patchName = str(body.name);
    if (patchName) patch.name = patchName;
    const minSelect = toInt(body.min_select);
    const maxSelect = toInt(body.max_select);
    if (minSelect !== null) patch.minSelect = minSelect;
    if (maxSelect !== null) patch.maxSelect = maxSelect;
    if (eventType === "modifier_group.deleted") patch.isActive = false;
    else if (typeof body.is_active === "boolean") patch.isActive = body.is_active;
    await tx.update(modifierGroups).set(patch).where(eq(modifierGroups.id, id));

    if (Array.isArray(body.items)) {
      await tx
        .delete(menuItemModifierGroups)
        .where(eq(menuItemModifierGroups.modifierGroupId, id));
      for (const rawPosItemId of body.items) {
        const posItemId = toInt(rawPosItemId);
        if (posItemId === null) continue;
        const [lk] = await tx
          .select({ id: menuItems.id })
          .from(menuItems)
          .where(
            and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.posItemId, posItemId)),
          )
          .limit(1);
        if (lk?.id) {
          await tx
            .insert(menuItemModifierGroups)
            .values({
              menuItemId: lk.id,
              modifierGroupId: id,
              restaurantId,
              lastSyncedAt: now,
            })
            .onConflictDoNothing({ target: [menuItemModifierGroups.menuItemId, menuItemModifierGroups.modifierGroupId] });
        }
      }
    }
  } else {
    const [ins] = await tx
      .insert(modifierGroups)
      .values({
        restaurantId,
        posGroupId,
        name,
        minSelect: toInt(body.min_select) ?? 0,
        maxSelect: toInt(body.max_select) ?? 1,
        isActive: eventType === "modifier_group.deleted" ? false : bool(body.is_active, true),
        lastSyncedAt: now,
      })
      .returning({ id: modifierGroups.id });
    id = ins?.id;
  }
  return {
    mappings: {
      modifier_groups: [{ pos_group_id: posGroupId, id: id ?? 0, name }],
    },
    mintedEntityId: id ?? null,
  };
}

async function applyModifierEvent(
  tx: DbTx,
  restaurantId: number,
  eventType: string,
  body: JsonObject,
  now: Date,
): Promise<{ mappings: MenuMappings; mintedEntityId: number | null }> {
  const posGroupId = toInt(body.pos_modifier_group_id) ?? toInt(body.marketplace_modifier_group_id);
  const posOptionId = toInt(body.pos_modifier_id) ?? toInt(body.marketplace_modifier_id);
  if (posOptionId === null) {
    return { mappings: {}, mintedEntityId: null };
  }
  const [grp] =
    posGroupId !== null
      ? await tx
          .select({ id: modifierGroups.id })
          .from(modifierGroups)
          .where(
            and(
              eq(modifierGroups.restaurantId, restaurantId),
              eq(modifierGroups.posGroupId, posGroupId),
            ),
          )
          .limit(1)
      : [];
  const groupId = grp?.id;
  if (!groupId) {
    return { mappings: {}, mintedEntityId: null };
  }

  if (eventType === "modifier.deleted") {
    const [existing] = await tx
      .select({ id: modifierOptions.id })
      .from(modifierOptions)
      .where(
        and(
          eq(modifierOptions.groupId, groupId),
          eq(modifierOptions.posOptionId, posOptionId),
        ),
      )
      .limit(1);
    if (existing?.id) {
      await tx
        .update(modifierOptions)
        .set({ available: false, lastSyncedAt: now })
        .where(eq(modifierOptions.id, existing.id));
    }
    return { mappings: {}, mintedEntityId: existing?.id ?? null };
  }

  const name = str(body.name) ?? "Option";
  const price = cents(body.price);
  const [row] = await tx
    .select({ id: modifierOptions.id })
    .from(modifierOptions)
    .where(
      and(eq(modifierOptions.groupId, groupId), eq(modifierOptions.posOptionId, posOptionId)),
    )
    .limit(1);
  let id = row?.id;
  if (id) {
    const patch: Partial<typeof modifierOptions.$inferInsert> = {
      name,
      isVeg: bool(body.isveg, true),
      available: bool(body.available, true),
      lastSyncedAt: now,
    };
    if (price !== null) patch.priceCents = price;
    await tx.update(modifierOptions).set(patch).where(eq(modifierOptions.id, id));
  } else {
    const [ins] = await tx
      .insert(modifierOptions)
      .values({
        groupId,
        restaurantId,
        posGroupId: posGroupId ?? 0,
        posOptionId,
        name,
        priceCents: price ?? 0,
        isVeg: bool(body.isveg, true),
        available: bool(body.available, true),
        lastSyncedAt: now,
      })
      .returning({ id: modifierOptions.id });
    id = ins?.id;
  }
  return {
    mappings: {
      modifiers: [{ pos_group_id: posGroupId ?? 0, pos_modifier_id: posOptionId, id: id ?? 0, name }],
    },
    mintedEntityId: id ?? null,
  };
}