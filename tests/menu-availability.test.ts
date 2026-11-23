/**
 * M3: sold-out state is read from the menu row's real `available` and
 * `stockQuantity` fields. The pure helper is the single definition used by the
 * public menu, the cart totals and checkout's server-authoritative bill.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  availableCartSubtotalCents,
  cartItemIsSoldOut,
  isMenuItemSoldOut,
  menuAvailabilityFromSections,
  type MenuAvailabilityMap,
} from "@/lib/menu-availability-core";
import type { MenuSection } from "@/lib/types";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const types = source("src/lib/types.ts");
const queries = source("src/db/queries.ts");
const card = compact(source("src/components/dish-card.tsx"));
const sheet = compact(source("src/components/dish-sheet.tsx"));
const miniCart = compact(source("src/components/mini-cart.tsx"));
const cartPage = compact(source("src/app/cart/page.tsx"));
const checkout = source("src/app/checkout/page.tsx");
const billRoute = source("src/app/api/orders/bill/route.ts");

test("the public DTO carries the real menu row availability", () => {
  assert.match(types, /available: boolean;/);
  assert.match(types, /stockQuantity: number \| null;/);
  assert.match(queries, /available: m\.available,/);
  assert.match(queries, /stockQuantity: m\.stockQuantity,/);
  assert.doesNotMatch(types.slice(0, types.indexOf("/* ------------------------- partner")), /soldOut/);
});

test("only the source flags decide whether a dish can be ordered", () => {
  assert.equal(isMenuItemSoldOut({ available: true, stockQuantity: null }), false);
  assert.equal(isMenuItemSoldOut({ available: true, stockQuantity: 4 }), false);
  assert.equal(isMenuItemSoldOut({ available: false, stockQuantity: 4 }), true);
  assert.equal(isMenuItemSoldOut({ available: true, stockQuantity: 0 }), true);
  assert.equal(isMenuItemSoldOut({ available: true, stockQuantity: -1 }), true);
});

test("availability maps keep only published menu facts", () => {
  const sections: MenuSection[] = [
    {
      category: "Mains",
      items: [
        {
          id: 7,
          restaurantId: 1,
          category: "Mains",
          name: "Paneer Tikka",
          description: "",
          priceCents: 32000,
          imageUrl: "/dish.jpg",
          isVeg: true,
          isBestseller: false,
          available: false,
          stockQuantity: 9,
        },
      ],
    },
  ];
  const availability = menuAvailabilityFromSections(sections);
  assert.deepEqual(availability, { 7: { available: false, stockQuantity: 9 } });
  assert.equal(cartItemIsSoldOut(availability, 7), true);
  // A dish absent from the fetched menu is unknown, not sold out.
  assert.equal(cartItemIsSoldOut(availability, 8), false);
  const legacy = [
    {
      category: "Mains",
      items: [{ ...sections[0].items[0], id: 9, available: undefined, stockQuantity: undefined }],
    },
  ] as unknown as MenuSection[];
  assert.deepEqual(menuAvailabilityFromSections(legacy), {});
});

test("cart totals exclude exactly the lines the server drops", () => {
  const availability: MenuAvailabilityMap = {
    1: { available: true, stockQuantity: null },
    2: { available: false, stockQuantity: 2 },
    3: { available: true, stockQuantity: 0 },
  };
  const total = availableCartSubtotalCents(
    [
      { menuItemId: 1, priceCents: 10000, quantity: 2, modifiers: [{ priceCents: 500, quantity: 1 }] },
      { menuItemId: 2, priceCents: 9000, quantity: 1 },
      { menuItemId: 3, priceCents: 8000, quantity: 1 },
    ],
    availability,
  );
  assert.equal(total, 20500);
});

test("search does not advertise available dishes with zero tracked stock", () => {
  assert.match(
    queries,
    /or\(isNull\(menuItems\.stockQuantity\), gt\(menuItems\.stockQuantity, 0\)\)/,
  );
  assert.match(queries, /mi\.stock_quantity is null or mi\.stock_quantity > 0/);
});

test("the bill preview reports the server's dropped lines", () => {
  assert.match(billRoute, /dropped: result\.dropped/);
  assert.match(checkout, /dropped\?: DroppedCartItem\[\]/);
  // Dropped lines come only from the preview keyed to the current cart + offer,
  // so a stale response cannot describe lines the customer no longer has.
  assert.match(checkout, /previewForSelection\(billState, billState\?\.key, selectionKey\)/);
  assert.match(
    checkout,
    /const dropped = activePreview\?\.ok && Array\.isArray\(activePreview\.dropped\) \? activePreview\.dropped : \[\]/,
  );
  assert.match(checkout, /will not be charged/);
  assert.match(queries, /ALL_ITEMS_SOLD_OUT/);
});

test("menu and cart surfaces show and enforce the same sold-out state", () => {
  assert.match(card, /isMenuItemSoldOut\(item\)/);
  assert.match(card, /soldOut=\{soldOut\}/);
  assert.match(sheet, /const canAdd = !soldOut/);
  assert.match(miniCart, /cartItemIsSoldOut\(availability, i\.menuItemId\)/);
  assert.match(miniCart, /availableCartSubtotalCents\(cart\.items, availability\)/);
  assert.match(cartPage, /soldOutLines\.length > 0/);
  assert.match(cartPage, /activeSubtotalCents/);
  assert.match(checkout, /hasBillableItems/);
});
