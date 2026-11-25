import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { menuItems, restaurants } from "@/db/schema";
import type { BulkMenuIssue, BulkMenuParseResult, BulkMenuRow } from "@/lib/bulk-menu-core";
import { DEFAULT_DISH_IMAGE, sanitizeImageUrl } from "@/lib/domain";

export type BulkMenuApplyResult =
  | { ok: true; updated: number }
  | { ok: false; error: string; issues: BulkMenuIssue[] };

type MenuPatch = Partial<typeof menuItems.$inferInsert>;

function buildPatch(row: BulkMenuRow, issues: BulkMenuIssue[]): MenuPatch {
  const patch: MenuPatch = {};
  if (row.category !== undefined) patch.category = row.category;
  if (row.name !== undefined) patch.name = row.name;
  if (row.description !== undefined) patch.description = row.description;
  if (row.priceCents !== undefined) patch.priceCents = row.priceCents;
  if (row.isVeg !== undefined) patch.isVeg = row.isVeg;
  if (row.available !== undefined) patch.available = row.available;
  if (row.stockQuantity !== undefined) patch.stockQuantity = row.stockQuantity;
  if (row.sort !== undefined) patch.sort = row.sort;
  if (row.imageUrl !== undefined) {
    const sanitized = sanitizeImageUrl(row.imageUrl, DEFAULT_DISH_IMAGE);
    if (row.imageUrl !== "" && sanitized !== row.imageUrl) {
      issues.push({ line: row.line, field: "imageUrl", message: "Use a local upload or an allowed image URL." });
    } else {
      patch.imageUrl = sanitized;
    }
  }
  if (Object.keys(patch).length === 0) {
    issues.push({ line: row.line, message: "No changes on this row." });
  }
  return patch;
}

/**
 * Applies a parsed paste as one all-or-nothing edit. Validation happens before
 * the first UPDATE, and every UPDATE additionally requires a NULL `pos_item_id`,
 * so a row that becomes POS-owned mid-request cannot be overwritten.
 */
export async function applyBulkMenuUpdates(
  restaurantId: number,
  parsed: BulkMenuParseResult,
): Promise<BulkMenuApplyResult> {
  if (!parsed.ok || parsed.rows.length === 0) {
    return {
      ok: false,
      error: parsed.error ?? "Fix the highlighted rows before applying.",
      issues: parsed.issues,
    };
  }
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
    return { ok: false, error: "Sign in again", issues: [] };
  }

  try {
    return await db.transaction(async (tx) => {
      const issues: BulkMenuIssue[] = [];
      const [owner] = await tx
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      if (!owner) return { ok: false as const, error: "Sign in again", issues: [] };

      const ids = parsed.rows
        .map((row) => row.id)
        .filter((id): id is number => id !== null);
      if (ids.length !== parsed.rows.length || ids.length === 0) {
        return { ok: false as const, error: "Every row needs a valid id.", issues: parsed.issues };
      }

      const stored = await tx
        .select({ id: menuItems.id, posItemId: menuItems.posItemId })
        .from(menuItems)
        .where(and(eq(menuItems.restaurantId, owner.id), inArray(menuItems.id, ids)));
      const byId = new Map(stored.map((row) => [row.id, row]));
      const seen = new Set<number>();
      const prepared: Array<{ id: number; patch: MenuPatch }> = [];

      for (const row of parsed.rows) {
        const id = row.id as number;
        if (seen.has(id)) {
          issues.push({ line: row.line, field: "id", message: `Duplicate id ${id}.` });
          continue;
        }
        seen.add(id);
        const current = byId.get(id);
        if (!current) {
          issues.push({ line: row.line, field: "id", message: "Dish not found in your menu." });
          continue;
        }
        if (row.posSynced === true || current.posItemId !== null) {
          issues.push({
            line: row.line,
            field: "id",
            message: "POS-owned dishes cannot be bulk edited.",
          });
          continue;
        }
        prepared.push({ id, patch: buildPatch(row, issues) });
      }

      if (issues.length > 0) {
        return { ok: false as const, error: "Fix the highlighted rows before applying.", issues };
      }

      for (const entry of prepared) {
        const [updated] = await tx
          .update(menuItems)
          .set(entry.patch)
          .where(
            and(
              eq(menuItems.id, entry.id),
              eq(menuItems.restaurantId, owner.id),
              isNull(menuItems.posItemId),
            ),
          )
          .returning({ id: menuItems.id });
        if (!updated) throw new Error("bulk update lost a row");
      }
      return { ok: true as const, updated: prepared.length };
    });
  } catch {
    return { ok: false, error: "Could not apply the bulk edit. Nothing was changed.", issues: [] };
  }
}
