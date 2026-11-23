import "server-only";
import { and, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationAudit,
  integrationRecords,
  merchantMenuImports,
  menuItemModifierGroups,
  menuItems,
  menuWebhookEvents,
  modifierGroups,
  modifierOptions,
  restaurants,
  type MenuItemRow,
  type ModifierGroupRow,
  type ModifierOptionRow,
} from "@/db/schema";
import {
  MenuImportError,
  menuImportPayloadHash,
  type NormalisedMenuReplacePayload,
} from "@/lib/menu-import-core";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type MerchantMenuReplaceResult = {
  revision: number;
  applied: {
    items: { created: number; updated: number; archived: number; unchanged: number };
    modifierGroups: { created: number; updated: number; disabled: number; unchanged: number };
    modifierOptions: { created: number; updated: number; disabled: number; unchanged: number };
  };
  items: Array<{ externalId: string; id: string; action: string }>;
  modifierGroups: Array<{ externalId: string; id: string; action: string }>;
  warnings: string[];
};

export type MerchantMenuImportContext = {
  restaurantId: number;
  businessId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function key(value: string): string {
  return value.trim().toLowerCase();
}

function sameNumbers(a: number | null, b: number | null): boolean {
  return a === b;
}

function sameIdLists(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort((x, y) => x - y).every((value, index) => value === [...b].sort((x, y) => x - y)[index]);
}

function dietaryOf(row: MenuItemRow): "veg" | "nonveg" | "unspecified" {
  if (row.dietary === "veg" || row.dietary === "nonveg" || row.dietary === "unspecified") return row.dietary;
  return row.isVeg ? "veg" : "nonveg";
}

async function nextGroupPosId(tx: DbTx, restaurantId: number): Promise<number> {
  const [row] = await tx
    .select({ lowest: sql<number | null>`min(${modifierGroups.posGroupId})` })
    .from(modifierGroups)
    .where(eq(modifierGroups.restaurantId, restaurantId));
  const lowest = row?.lowest ?? null;
  return lowest !== null && lowest < 0 ? lowest - 1 : -1;
}

async function nextOptionPosId(tx: DbTx, groupId: number): Promise<number> {
  const [row] = await tx
    .select({ lowest: sql<number | null>`min(${modifierOptions.posOptionId})` })
    .from(modifierOptions)
    .where(eq(modifierOptions.groupId, groupId));
  const lowest = row?.lowest ?? null;
  return lowest !== null && lowest < 0 ? lowest - 1 : -1;
}

/** Current menu revision shared with POS menu-webhook ingestion. */
export async function getMerchantMenuRevision(restaurantId: number): Promise<number> {
  const [record] = await db
    .select({ latest: integrationRecords.latestMenuVersion })
    .from(integrationRecords)
    .where(eq(integrationRecords.restaurantId, restaurantId))
    .limit(1);
  const [event] = await db
    .select({ latest: max(menuWebhookEvents.menuVersion) })
    .from(menuWebhookEvents)
    .where(eq(menuWebhookEvents.restaurantId, restaurantId));
  return Math.max(record?.latest ?? 1, event?.latest ?? 1);
}

/**
 * Apply a validated full-menu replacement atomically.
 *
 * Throws MenuImportError for every contract-level failure; the route maps those
 * to the documented status/code pairs. Any other failure is treated as a safe
 * retryable `replace_failed` because the transaction rolls back as one unit.
 */
export async function applyMerchantMenuReplace(
  payload: NormalisedMenuReplacePayload,
  ctx: MerchantMenuImportContext,
): Promise<MerchantMenuReplaceResult> {
  const payloadHash = menuImportPayloadHash(payload);

  try {
    return await db.transaction(async (tx) => {
      // Serialises all menu writes for this outlet, including POS ingestion that
      // locks the same restaurant row before minting negative partner ids.
      const [restaurant] = await tx
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.id, ctx.restaurantId))
        .limit(1)
        .for("update");
      if (!restaurant) {
        throw MenuImportError.validation([{ row: null, column: "restaurantId", code: "not_found", message: "Restaurant not found." }]);
      }

      await tx
        .insert(integrationRecords)
        .values({ restaurantId: restaurant.id })
        .onConflictDoNothing({ target: integrationRecords.restaurantId });
      const [record] = await tx
        .select({ id: integrationRecords.id, latest: integrationRecords.latestMenuVersion })
        .from(integrationRecords)
        .where(eq(integrationRecords.restaurantId, restaurant.id))
        .limit(1)
        .for("update");
      if (!record) throw MenuImportError.replaceFailed();

      const [event] = await tx
        .select({ latest: max(menuWebhookEvents.menuVersion) })
        .from(menuWebhookEvents)
        .where(eq(menuWebhookEvents.restaurantId, restaurant.id));
      const currentRevision = Math.max(record?.latest ?? 1, event?.latest ?? 1);

      // Check replay before the revision guard: a delayed/retried response must
      // not fail just because another import advanced the cached revision.
      const [existingImport] = await tx
        .select()
        .from(merchantMenuImports)
        .where(and(
          eq(merchantMenuImports.restaurantId, restaurant.id),
          eq(merchantMenuImports.importId, payload.importId),
        ))
        .limit(1)
        .for("update");
      if (existingImport) {
        if (existingImport.payloadHash !== payloadHash) throw MenuImportError.idempotencyConflict();
        return existingImport.result as unknown as MerchantMenuReplaceResult;
      }
      if (payload.expectedRevision !== currentRevision) {
        throw MenuImportError.revisionConflict(currentRevision);
      }

      const nextRevision = currentRevision + 1;
      const [existingItems, existingGroups, existingOptions, existingLinks] = await Promise.all([
        tx.select().from(menuItems).where(eq(menuItems.restaurantId, restaurant.id)),
        tx.select().from(modifierGroups).where(eq(modifierGroups.restaurantId, restaurant.id)),
        tx.select().from(modifierOptions).where(eq(modifierOptions.restaurantId, restaurant.id)),
        tx.select().from(menuItemModifierGroups).where(eq(menuItemModifierGroups.restaurantId, restaurant.id)),
      ]);

      const itemByKey = new Map<string, MenuItemRow>();
      for (const row of existingItems) {
        if (row.externalId) {
          const normalized = key(row.externalId);
          if (!itemByKey.has(normalized)) itemByKey.set(normalized, row);
        }
      }
      const groupByKey = new Map<string, ModifierGroupRow>();
      for (const row of existingGroups) {
        if (row.externalId) {
          const normalized = key(row.externalId);
          if (!groupByKey.has(normalized)) groupByKey.set(normalized, row);
        }
      }
      const optionByGroupAndKey = new Map<string, ModifierOptionRow>();
      for (const row of existingOptions) {
        if (row.externalId) {
          const normalized = `${row.groupId}:${key(row.externalId)}`;
          if (!optionByGroupAndKey.has(normalized)) optionByGroupAndKey.set(normalized, row);
        }
      }
      const currentLinksByItem = new Map<number, number[]>();
      for (const link of existingLinks) {
        const list = currentLinksByItem.get(link.menuItemId) ?? [];
        list.push(link.modifierGroupId);
        currentLinksByItem.set(link.menuItemId, list);
      }

      const applied: MerchantMenuReplaceResult["applied"] = {
        items: { created: 0, updated: 0, archived: 0, unchanged: 0 },
        modifierGroups: { created: 0, updated: 0, disabled: 0, unchanged: 0 },
        modifierOptions: { created: 0, updated: 0, disabled: 0, unchanged: 0 },
      };
      const itemResults: MerchantMenuReplaceResult["items"] = [];
      const groupResults: MerchantMenuReplaceResult["modifierGroups"] = [];
      const idsByItemKey = new Map<string, number>();
      const idsByGroupKey = new Map<string, number>();

      // --- modifier groups and their options ---------------------------------
      const desiredGroupKeys = new Set(payload.modifierGroups.map((group) => group.externalKey));
      for (const desired of payload.modifierGroups) {
        const existing = groupByKey.get(desired.externalKey);
        let groupId: number;
        let groupPosId: number;
        let action: string;
        if (existing) {
          if (existing.posGroupId > 0) {
            throw MenuImportError.validation([{ row: null, column: "modifierGroups.externalId", code: "pos_owned", message: `Modifier group ${desired.externalId} is POS-owned.` }]);
          }
          const unchanged = existing.name === desired.name
            && existing.minSelect === desired.minSelect
            && existing.maxSelect === desired.maxSelect
            && existing.isActive === desired.isActive;
          if (unchanged) {
            applied.modifierGroups.unchanged += 1;
            action = "unchanged";
          } else {
            await tx.update(modifierGroups).set({
              externalId: desired.externalId,
              name: desired.name,
              minSelect: desired.minSelect,
              maxSelect: desired.maxSelect,
              isActive: desired.isActive,
            }).where(eq(modifierGroups.id, existing.id));
            applied.modifierGroups.updated += 1;
            action = "updated";
          }
          groupId = existing.id;
          groupPosId = existing.posGroupId;
        } else {
          groupPosId = await nextGroupPosId(tx, restaurant.id);
          const [row] = await tx.insert(modifierGroups).values({
            restaurantId: restaurant.id,
            externalId: desired.externalId,
            posGroupId: groupPosId,
            name: desired.name,
            minSelect: desired.minSelect,
            maxSelect: desired.maxSelect,
            isActive: desired.isActive,
          }).returning({ id: modifierGroups.id });
          groupId = row.id;
          applied.modifierGroups.created += 1;
          action = "created";
        }
        idsByGroupKey.set(desired.externalKey, groupId);
        groupResults.push({ externalId: desired.externalId, id: String(groupId), action });

        const desiredOptionKeys = new Set(desired.options.map((option) => option.externalKey));
        for (const option of desired.options) {
          const optionKey = `${groupId}:${option.externalKey}`;
          const existingOption = optionByGroupAndKey.get(optionKey);
          if (existingOption) {
            const unchanged = existingOption.name === option.name
              && existingOption.priceCents === option.priceCents
              && existingOption.isVeg === option.isVeg
              && existingOption.available === option.available;
            if (unchanged) {
              applied.modifierOptions.unchanged += 1;
            } else {
              await tx.update(modifierOptions).set({
                externalId: option.externalId,
                name: option.name,
                priceCents: option.priceCents,
                isVeg: option.isVeg,
                available: option.available,
              }).where(eq(modifierOptions.id, existingOption.id));
              applied.modifierOptions.updated += 1;
            }
          } else {
            await tx.insert(modifierOptions).values({
              groupId,
              restaurantId: restaurant.id,
              externalId: option.externalId,
              posGroupId: groupPosId,
              posOptionId: await nextOptionPosId(tx, groupId),
              name: option.name,
              priceCents: option.priceCents,
              isVeg: option.isVeg,
              available: option.available,
            });
            applied.modifierOptions.created += 1;
          }
        }
        const staleOptions = existingOptions.filter(
          (row) => row.groupId === groupId && row.externalId && !desiredOptionKeys.has(key(row.externalId)),
        );
        if (staleOptions.length > 0) {
          const staleIds = staleOptions.filter((row) => row.available).map((row) => row.id);
          applied.modifierOptions.disabled += staleIds.length;
          await tx.update(modifierOptions)
            .set({ available: false })
            .where(and(
              eq(modifierOptions.restaurantId, restaurant.id),
              inArray(modifierOptions.id, staleOptions.map((row) => row.id)),
            ));
        }
      }

      // Disable absent groups, their options, and their dish attachments.
      const staleGroups = existingGroups.filter(
        (row) => row.externalId && !desiredGroupKeys.has(key(row.externalId)),
      );
      if (staleGroups.length > 0) {
        const staleGroupIds = staleGroups.map((row) => row.id);
        const staleGroupOptionIds = existingOptions
          .filter((row) => staleGroupIds.includes(row.groupId) && row.available)
          .map((row) => row.id);
        applied.modifierGroups.disabled += staleGroups.filter((row) => row.isActive).length;
        applied.modifierOptions.disabled += staleGroupOptionIds.length;
        await tx.update(modifierGroups)
          .set({ isActive: false })
          .where(and(eq(modifierGroups.restaurantId, restaurant.id), inArray(modifierGroups.id, staleGroupIds)));
        if (staleGroupOptionIds.length > 0) {
          await tx.update(modifierOptions)
            .set({ available: false })
            .where(and(eq(modifierOptions.restaurantId, restaurant.id), inArray(modifierOptions.id, staleGroupOptionIds)));
        }
        await tx.delete(menuItemModifierGroups)
          .where(and(eq(menuItemModifierGroups.restaurantId, restaurant.id), inArray(menuItemModifierGroups.modifierGroupId, staleGroupIds)));
      }

      // --- dishes and their modifier-group links ------------------------------
      const desiredItemKeys = new Set(payload.items.map((item) => item.externalKey));
      const desiredLinksByItem = new Map<string, number[]>();
      for (const [index, desired] of payload.items.entries()) {
        const groupIds = desired.modifierGroupKeys.map((groupKey) => {
          const groupId = idsByGroupKey.get(groupKey);
          if (groupId === undefined) {
            throw MenuImportError.unresolvedReference([{ row: null, column: "modifierGroupKeys", code: "unresolved_reference", message: `Modifier group ${groupKey} is missing.` }]);
          }
          return groupId;
        });
        desiredLinksByItem.set(desired.externalKey, [...new Set(groupIds)].sort((a, b) => a - b));

        const existing = itemByKey.get(desired.externalKey);
        let itemId: number;
        let action: string;
        const patch = {
          externalId: desired.externalId,
          name: desired.name,
          category: desired.category,
          description: desired.description,
          priceCents: desired.price,
          dietary: desired.dietary,
          isVeg: desired.dietary === "veg",
          available: desired.available,
          archived: false,
          stockQuantity: desired.stockQuantity,
          imageUrl: desired.imageUrl,
        };
        if (existing) {
          if (existing.posItemId !== null) {
            throw MenuImportError.validation([{ row: null, column: "items.externalId", code: "pos_owned", message: `Menu item ${desired.externalId} is POS-owned.` }]);
          }
          const currentLinks = (currentLinksByItem.get(existing.id) ?? []).slice().sort((a, b) => a - b);
          const unchanged = existing.name === patch.name
            && existing.category === patch.category
            && existing.description === patch.description
            && existing.priceCents === patch.priceCents
            && dietaryOf(existing) === patch.dietary
            && existing.isVeg === patch.isVeg
            && existing.available === patch.available
            && existing.archived === false
            && sameNumbers(existing.stockQuantity, patch.stockQuantity)
            && existing.imageUrl === patch.imageUrl
            && sameIdLists(currentLinks, desiredLinksByItem.get(desired.externalKey) ?? []);
          if (unchanged) {
            applied.items.unchanged += 1;
            action = "unchanged";
          } else {
            await tx.update(menuItems).set(patch).where(eq(menuItems.id, existing.id));
            applied.items.updated += 1;
            action = "updated";
          }
          itemId = existing.id;
        } else {
          const [row] = await tx.insert(menuItems).values({
            restaurantId: restaurant.id,
            ...patch,
            sort: index,
            posItemId: null,
            posCategoryId: null,
            categoryId: null,
            lastSyncedAt: null,
            isBestseller: false,
          }).returning({ id: menuItems.id });
          itemId = row.id;
          applied.items.created += 1;
          action = "created";
        }
        idsByItemKey.set(desired.externalKey, itemId);
        itemResults.push({ externalId: desired.externalId, id: String(itemId), action });
      }

      for (const [itemKey, groupIds] of desiredLinksByItem) {
        const itemId = idsByItemKey.get(itemKey);
        if (itemId === undefined) continue;
        const current = (currentLinksByItem.get(itemId) ?? []).slice().sort((a, b) => a - b);
        if (sameIdLists(current, groupIds)) continue;
        await tx.delete(menuItemModifierGroups).where(and(
          eq(menuItemModifierGroups.restaurantId, restaurant.id),
          eq(menuItemModifierGroups.menuItemId, itemId),
        ));
        for (const groupId of groupIds) {
          await tx.insert(menuItemModifierGroups).values({
            menuItemId: itemId,
            modifierGroupId: groupId,
            restaurantId: restaurant.id,
          }).onConflictDoNothing();
        }
      }

      const staleItems = existingItems.filter(
        (row) => row.externalId && !desiredItemKeys.has(key(row.externalId)),
      );
      if (staleItems.length > 0) {
        applied.items.archived += staleItems.filter((row) => !row.archived || row.available).length;
        await tx.update(menuItems)
          .set({ available: false, archived: true })
          .where(and(eq(menuItems.restaurantId, restaurant.id), inArray(menuItems.id, staleItems.map((row) => row.id))));
        await tx.delete(menuItemModifierGroups)
          .where(and(eq(menuItemModifierGroups.restaurantId, restaurant.id), inArray(menuItemModifierGroups.menuItemId, staleItems.map((row) => row.id))));
      }

      // Advance the shared counter, persist the immutable replay result, and
      // audit in the same transaction so a partial replacement cannot be observed.
      await tx.update(integrationRecords)
        .set({ latestMenuVersion: nextRevision })
        .where(eq(integrationRecords.id, record.id));

      const result: MerchantMenuReplaceResult = {
        revision: nextRevision,
        applied,
        items: itemResults,
        modifierGroups: groupResults,
        warnings: [],
      };
      await tx.insert(merchantMenuImports).values({
        restaurantId: restaurant.id,
        importId: payload.importId,
        businessId: ctx.businessId,
        payloadHash,
        fromRevision: currentRevision,
        toRevision: nextRevision,
        result: result as unknown as Record<string, unknown>,
      });
      await tx.insert(integrationAudit).values({
        restaurantId: restaurant.id,
        actor: "partner",
        event: "MERCHANT_MENU_REPLACED",
        detail: {
          importId: payload.importId,
          businessId: ctx.businessId,
          source: "merchant_app",
          fromRevision: currentRevision,
          toRevision: nextRevision,
          payloadHash,
          counts: applied,
          ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
        },
        ipAddress: ctx.ipAddress ?? null,
      });
      return result;
    });
  } catch (error) {
    if (error instanceof MenuImportError) throw error;
    throw MenuImportError.replaceFailed();
  }
}
