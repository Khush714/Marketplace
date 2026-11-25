import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReorderLines, menuItemsFromPayload } from "../src/lib/reorder-core";
import type { MenuItemDto } from "../src/lib/types";
import type { OrderItemSnapshot } from "../src/db/schema";

function menuItem(overrides: Partial<MenuItemDto> = {}): MenuItemDto {
  return {
    id: 1,
    restaurantId: 9,
    category: "Mains",
    name: "Biryani",
    description: "",
    priceCents: 20_000,
    imageUrl: "/api/media/1",
    isVeg: false,
    isBestseller: false,
    available: true,
    stockQuantity: null,
    modifierGroups: [
      {
        id: 7,
        name: "Spice",
        minSelect: 0,
        maxSelect: 1,
        options: [{ id: 70, name: "Extra spicy", priceCents: 500, isVeg: true }],
      },
    ],
    ...overrides,
  };
}

function snapshot(overrides: Partial<OrderItemSnapshot> = {}): OrderItemSnapshot {
  return {
    menuItemId: 1,
    name: "Biryani",
    priceCents: 18_000,
    quantity: 2,
    imageUrl: "/api/media/1",
    isVeg: false,
    modifiers: [{ optionId: 70, name: "Extra spicy", priceCents: 300, quantity: 1 }],
    ...overrides,
  };
}

test("menuItemsFromPayload flattens public sections and rejects junk rows", () => {
  const items = menuItemsFromPayload({
    sections: [
      { items: [menuItem(), { id: "bad", name: "Junk", available: true }, null] },
      { items: [menuItem({ id: 2, name: "Curry" })] },
    ],
  });
  assert.deepEqual(
    items.map((item) => item.id),
    [1, 2],
  );
  assert.deepEqual(menuItemsFromPayload({ items: [menuItem()] }), []);
});

test("reorder uses today's price and modifier definitions, not the order snapshot", () => {
  const result = buildReorderLines(
    { items: [snapshot()] },
    [menuItem()],
  );
  assert.equal(result.changed, true);
  assert.equal(result.unavailableNames.length, 0);
  assert.equal(result.lines.length, 1);
  const line = result.lines[0];
  assert.equal(line.priceCents, 20_000);
  assert.equal(line.name, "Biryani");
  assert.equal(line.lineKey, "1::70x1");
  assert.equal(line.modifiers?.[0].priceCents, 500);
  assert.equal(line.modifiers?.[0].groupId, 7);
  assert.equal(line.quantity, 2);
});

test("reorder drops sold-out dishes and stale modifiers without inventing cart lines", () => {
  const result = buildReorderLines(
    {
      items: [
        snapshot({ modifiers: [{ optionId: 999, name: "Removed", priceCents: 100, quantity: 1 }] }),
        snapshot({ menuItemId: 3, name: "Sold out dish", priceCents: 9_000 }),
      ],
    },
    [menuItem(), menuItem({ id: 3, stockQuantity: 0 })],
  );
  assert.equal(result.changed, true);
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.unavailableNames, ["Sold out dish"]);
  assert.equal(result.lines[0].modifiers, undefined);
  assert.equal(result.lines[0].lineKey, "1");
});

test("reorder clamps hostile quantities and bounds the snapshot", () => {
  const result = buildReorderLines(
    {
      items: Array.from({ length: 60 }, (_, index) =>
        snapshot({ menuItemId: index + 1, quantity: index === 0 ? 99 : 1 }),
      ),
    },
    [menuItem()],
  );
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].quantity, 10);
  assert.equal(result.changed, true);
});
