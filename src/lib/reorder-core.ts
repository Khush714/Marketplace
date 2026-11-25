/** Pure mapping of an order snapshot onto today's menu for one-tap reorder. */

import type { OrderItemSnapshot } from "@/db/schema";
import type { MenuItemDto, ModifierGroupDto, ModifierOptionDto } from "@/lib/types";

export interface ReorderModifier {
  optionId: number;
  groupId: number;
  name: string;
  priceCents: number;
  quantity: number;
  isVeg: boolean;
}

export interface ReorderLine {
  menuItemId: number;
  name: string;
  priceCents: number;
  imageUrl: string;
  isVeg: boolean;
  quantity: number;
  modifiers?: ReorderModifier[];
  lineKey: string;
}

export interface ReorderResult {
  lines: ReorderLine[];
  unavailableNames: string[];
  /** True when anything about a past line is no longer on today's menu. */
  changed: boolean;
}

const MAX_REORDER_LINES = 50;
const MAX_LINE_QUANTITY = 10;
const MAX_MENU_ITEMS = 500;

/* Mirrors lineKeyFor in lib/cart.tsx so reordered lines merge with existing ones. */
function keyFor(menuItemId: number, modifiers: ReorderModifier[]): string {
  const opts = modifiers
    .filter((m) => m.quantity > 0)
    .map((m) => `${m.optionId}x${m.quantity}`)
    .sort();
  return opts.length ? `${menuItemId}::${opts.join(",")}` : String(menuItemId);
}

function dishAvailable(item: MenuItemDto): boolean {
  return item.available && (item.stockQuantity === null || item.stockQuantity > 0);
}

function currentOptions(item: MenuItemDto): Map<number, { group: ModifierGroupDto; option: ModifierOptionDto }> {
  const byId = new Map<number, { group: ModifierGroupDto; option: ModifierOptionDto }>();
  for (const group of item.modifierGroups ?? []) {
    for (const option of group.options ?? []) {
      if (!byId.has(option.id)) byId.set(option.id, { group, option });
    }
  }
  return byId;
}

function isMenuItem(raw: unknown): raw is MenuItemDto {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as Partial<MenuItemDto>;
  return Number.isInteger(item.id) && (item.id ?? 0) > 0 && typeof item.name === "string" && typeof item.available === "boolean";
}

/** The public listing endpoint returns sections, not a flat menu array. */
export function menuItemsFromPayload(raw: unknown): MenuItemDto[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const sections = (raw as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return [];
  const items: MenuItemDto[] = [];
  for (const section of sections.slice(0, 100)) {
    const rows = section && typeof section === "object" ? (section as { items?: unknown }).items : null;
    if (!Array.isArray(rows)) continue;
    for (const row of rows.slice(0, 200)) {
      if (isMenuItem(row)) items.push(row);
      if (items.length >= MAX_MENU_ITEMS) return items;
    }
  }
  return items;
}

export function buildReorderLines(
  order: { items: readonly OrderItemSnapshot[] },
  menu: readonly MenuItemDto[],
): ReorderResult {
  const byId = new Map<number, MenuItemDto>();
  for (const item of menu.slice(0, MAX_MENU_ITEMS)) {
    if (isMenuItem(item)) byId.set(item.id, item);
  }

  const lines: ReorderLine[] = [];
  const unavailableNames: string[] = [];
  let changed = false;

  for (const snapshot of order.items.slice(0, MAX_REORDER_LINES)) {
    const current = byId.get(snapshot.menuItemId);
    if (!current || !dishAvailable(current)) {
      unavailableNames.push(snapshot.name);
      changed = true;
      continue;
    }

    const options = currentOptions(current);
    const modifiers: ReorderModifier[] = [];
    const seen = new Set<number>();
    for (const old of snapshot.modifiers ?? []) {
      if (!old || !Number.isInteger(old.optionId) || seen.has(old.optionId)) {
        changed = true;
        continue;
      }
      seen.add(old.optionId);
      const match = options.get(old.optionId);
      if (!match) {
        changed = true;
        continue;
      }
      const quantity = Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.floor(old.quantity) || 1));
      if (quantity !== old.quantity) changed = true;
      modifiers.push({
        optionId: match.option.id,
        groupId: match.group.id,
        name: match.option.name,
        priceCents: match.option.priceCents,
        quantity,
        isVeg: match.option.isVeg,
      });
    }

    if (current.priceCents !== snapshot.priceCents) changed = true;
    const quantity = Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.floor(snapshot.quantity) || 1));
    if (quantity !== snapshot.quantity) changed = true;
    lines.push({
      menuItemId: current.id,
      name: current.name,
      priceCents: current.priceCents,
      imageUrl: typeof current.imageUrl === "string" ? current.imageUrl : "",
      isVeg: current.isVeg,
      quantity,
      ...(modifiers.length ? { modifiers } : {}),
      lineKey: keyFor(current.id, modifiers),
    });
  }

  return { lines, unavailableNames, changed };
}
