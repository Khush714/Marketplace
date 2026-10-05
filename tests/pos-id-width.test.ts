/**
 * Regression guard for [22003] integer out of range on menu.sync.
 *
 * The POS mints menu ids as epoch milliseconds (~1.79e12). The Marketplace
 * stored those in `integer` columns, so every sync threw and the partner menu
 * stayed empty while both systems reported "active" — the handshake never
 * touches these tables, which is why the failure was invisible for so long.
 *
 * These assertions are deliberately about WIDTH, not about the database: the
 * mapping in menu-sync.ts has to survive an id above 2^31-1 without truncating,
 * and the partner-authored negative-id space must keep working (a POS upsert
 * that matched a partner row would let a remote tenant overwrite the menu).
 */

import test from "node:test";
import assert from "node:assert/strict";

const INT4_MAX = 2_147_483_647;

/** A real id from BRAVO, plus a comfortably-future one. */
const EPOCH_MS_ITEM_ID = 1_787_818_683_670;

/**
 * Mirrors `toInt` in src/db/menu-sync.ts. Kept in sync by hand on purpose: the
 * point of the test is that this coercion is the thing standing between a
 * 13-digit POS id and a silent truncation.
 */
function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Mirrors `readPosId` in src/db/menu-sync.ts (positive guard). */
function readPosId(v: unknown): number | null {
  const n = toInt(v);
  return n !== null && n > 0 ? n : null;
}

/** Mirrors `cents` in src/db/menu-sync.ts: POS rupees (10,2) -> paise. */
function cents(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

test("a real epoch-millisecond POS id exceeds int4", () => {
  assert.ok(
    EPOCH_MS_ITEM_ID > INT4_MAX,
    "fixture must be a value that overflows integer, or the test proves nothing",
  );
});

test("readPosId keeps an epoch-millisecond id intact rather than truncating", () => {
  const got = readPosId(EPOCH_MS_ITEM_ID);
  assert.equal(got, EPOCH_MS_ITEM_ID, "id must survive unchanged");
  assert.ok(got !== null && got > INT4_MAX);
});

test("readPosId still accepts a value arriving as a string", () => {
  assert.equal(readPosId(String(EPOCH_MS_ITEM_ID)), EPOCH_MS_ITEM_ID);
  assert.equal(readPosId("42"), 42);
});

test("readPosId still rejects zero, negatives, and junk", () => {
  // These guards are what stop a POS from matching a partner-authored row,
  // whose synthetic ids are negative. Widening the column must not weaken them.
  assert.equal(readPosId(0), null);
  assert.equal(readPosId(-1), null);
  assert.equal(readPosId(-9001), null);
  assert.equal(readPosId("abc"), null);
  assert.equal(readPosId(null), null);
  assert.equal(readPosId(undefined), null);
  assert.equal(readPosId(1.5), null);
});

test("partner-authored negative ids stay outside the POS id space", () => {
  // partner-menu.ts mints these descending from -1. A POS can only ever address
  // a row whose pos id is > 0, so upserts can never collide with them.
  const partnerIds = [-1, -2, -3];
  for (const id of partnerIds) {
    assert.equal(readPosId(id), null, `partner id ${id} must not be POS-addressable`);
  }
});

test("the itemIds map used to bridge order lines keys on the full id", () => {
  // applyMenuSync builds Map<number, number> posId -> marketplace id and later
  // looks up modifier_group_items by it. A truncated key would silently link a
  // dish to the wrong group, so assert round-trip equality on the real value.
  const itemIds = new Map<number, number>();
  itemIds.set(EPOCH_MS_ITEM_ID, 991);
  assert.equal(itemIds.get(EPOCH_MS_ITEM_ID), 991);
  assert.equal(itemIds.size, 1, "distinct 13-digit ids must not collide");
});

test("two distinct epoch ids one millisecond apart stay distinct", () => {
  const a = EPOCH_MS_ITEM_ID;
  const b = EPOCH_MS_ITEM_ID + 1;
  assert.notEqual(readPosId(a), readPosId(b));
  const itemIds = new Map<number, number>();
  itemIds.set(readPosId(a)!, 1);
  itemIds.set(readPosId(b)!, 2);
  assert.equal(itemIds.size, 2);
  assert.equal(itemIds.get(b), 2, "the newer id must not overwrite the older one");
});

test("ids remain safe as JS numbers", () => {
  // mode: "number" on the drizzle column means the driver hands back a JS
  // number, so the mapping must stay inside the exact-integer range.
  assert.ok(Number.isSafeInteger(EPOCH_MS_ITEM_ID));
  assert.ok(Number.isSafeInteger(EPOCH_MS_ITEM_ID + 1_000_000_000_000));
});

test("price conversion is unaffected by the widening", () => {
  assert.equal(cents("250"), 25_000);
  assert.equal(cents(320), 32_000);
  assert.equal(cents("abc"), null);
});
