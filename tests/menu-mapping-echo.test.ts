/**
 * Regression tests for the menu mapping echo contract.
 *
 * Run with: npm test
 *
 * A live onboarding of a sixth tenant exposed this: the POS captures minted ids
 * from the `menu.sync` response using the entity-scoped keys
 * `marketplace_category_id` / `marketplace_group_id` /
 * `marketplace_modifier_id` / `marketplace_item_id`, while the Marketplace only
 * emitted `id` for everything but items. The POS therefore stored the literal
 * string "undefined" — and because each mapping table is unique on
 * (restaurant_id, marketplace_*_id), the FIRST entity of each kind consumed that
 * key for the whole tenant. 6 categories round-tripped as 1; 3 modifiers as 1.
 *
 * These assert both keys are always present and always agree, since a mismatch
 * would reintroduce the same silent loss through the other key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  categoryMapping,
  itemMapping,
  modifierGroupMapping,
  modifierMapping,
} from "../src/db/menu-mapping-echo";

test("a category mapping carries the id under both keys", () => {
  const m = categoryMapping(113, 7, "Starters");
  assert.equal(m.id, 7);
  assert.equal(m.marketplace_category_id, "7");
  assert.equal(m.pos_category_id, 113);
  assert.equal(m.name, "Starters");
});

test("an item mapping carries the id under both keys", () => {
  const m = itemMapping(1787818685103, 1798, "Tandoori Paneer Tikka");
  assert.equal(m.id, 1798);
  assert.equal(m.marketplace_item_id, "1798");
  assert.equal(m.pos_item_id, 1787818685103);
});

test("a modifier group mapping carries the id under both keys", () => {
  const m = modifierGroupMapping(46, 11, "Spice Level");
  assert.equal(m.id, 11);
  assert.equal(m.marketplace_group_id, "11");
});

test("a modifier mapping carries the id under both keys", () => {
  const m = modifierMapping(46, 47, 23, "Medium");
  assert.equal(m.id, 23);
  assert.equal(m.marketplace_modifier_id, "23");
  assert.equal(m.pos_group_id, 46);
  assert.equal(m.pos_modifier_id, 47);
});

test("no mapping ever emits the string 'undefined'", () => {
  // The exact shape that broke onboarding: a missing key stringified into the
  // POS's mapping column and then ate the tenant's unique slot.
  const echoes = [
    categoryMapping(113, 7, "Starters"),
    itemMapping(1787818685103, 1798, "Tandoori Paneer Tikka"),
    modifierGroupMapping(46, 11, "Spice Level"),
    modifierMapping(46, 47, 23, "Medium"),
  ];
  for (const echo of echoes) {
    for (const [key, value] of Object.entries(echo)) {
      assert.notEqual(String(value), "undefined", `${key} must never stringify to undefined`);
    }
  }
});

test("every mapping is JSON-serialisable without dropping a key", () => {
  // The payload crosses the wire as JSON; a non-serialisable value would be
  // silently dropped by JSON.stringify and reintroduce the same bug.
  for (const echo of [
    categoryMapping(1, 2, "a"),
    itemMapping(1, 2, "b"),
    modifierGroupMapping(1, 2, "c"),
    modifierMapping(1, 2, 3, "d"),
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(echo)), echo);
  }
});

test("distinct entities never collide on the POS's unique keys", () => {
  // (restaurant_id, marketplace_*_id) is unique per tenant, so the echoed id has
  // to be the per-entity minted id — never a shared constant.
  const cats = [categoryMapping(113, 7), categoryMapping(114, 8), categoryMapping(115, 9)];
  assert.equal(new Set(cats.map((c) => c.marketplace_category_id)).size, 3);

  const mods = [
    modifierMapping(46, 46, 22, "Mild"),
    modifierMapping(46, 47, 23, "Medium"),
    modifierMapping(46, 48, 24, "Hot"),
  ];
  assert.equal(new Set(mods.map((m) => m.marketplace_modifier_id)).size, 3);
});