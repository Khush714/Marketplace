import type { MenuItemDto, MenuSection } from "@/lib/types";

export interface MenuAvailability {
  available: boolean;
  stockQuantity: number | null;
}

/** Keyed by menu item id. Absent means the menu did not tell us about the dish. */
export type MenuAvailabilityMap = Record<number, MenuAvailability>;

/**
 * The single definition of "cannot be ordered" shared by the public menu, the
 * cart and computeBill. Both signals come from the menu row: `available` is the
 * kitchen's own switch, and tracked stock at or below zero is sold out there.
 */
export function isMenuItemSoldOut(
  item: Pick<MenuItemDto, "available" | "stockQuantity">,
): boolean {
  return !item.available || (item.stockQuantity !== null && item.stockQuantity <= 0);
}

export function menuAvailabilityFromSections(sections: MenuSection[]): MenuAvailabilityMap {
  const map: MenuAvailabilityMap = {};
  for (const section of sections) {
    for (const item of section.items) {
      // A cached pre-M3 payload has no availability fields. Treat that dish as
      // unknown rather than sold out; absence is not the kitchen's decision.
      if (typeof item.available !== "boolean") continue;
      if (item.stockQuantity !== null && !Number.isFinite(item.stockQuantity)) continue;
      map[item.id] = { available: item.available, stockQuantity: item.stockQuantity };
    }
  }
  return map;
}

export function cartItemIsSoldOut(
  availability: MenuAvailabilityMap,
  menuItemId: number,
): boolean {
  const item = availability[menuItemId];
  return item ? isMenuItemSoldOut(item) : false;
}

interface PricedCartLine {
  menuItemId: number;
  priceCents: number;
  quantity: number;
  modifiers?: { priceCents: number; quantity: number }[];
}

/**
 * Mirrors computeBill's line pricing so the cart never totals a dish checkout
 * will drop. A dish missing from the fetched menu is left alone — absence is
 * not evidence of sold-out, and the server remains authoritative at placement.
 */
export function availableCartSubtotalCents(
  items: PricedCartLine[],
  availability: MenuAvailabilityMap,
): number {
  return items.reduce((sum, item) => {
    if (cartItemIsSoldOut(availability, item.menuItemId)) return sum;
    const modifiers = (item.modifiers ?? []).reduce(
      (mods, m) => mods + m.priceCents * m.quantity,
      0,
    );
    return sum + item.priceCents * item.quantity + modifiers;
  }, 0);
}
