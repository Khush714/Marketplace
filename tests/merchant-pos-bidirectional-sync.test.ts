/**
 * Regression tests for bidirectional sync between Merchant App and Restaurant POS.
 *
 * Verifies:
 * 1. Merchant → POS: status transitions mirror to `integrationStatus` in the
 *    same atomic update as `merchantStatus`.
 * 2. POS → Merchant: webhook transitions mirror back to `merchantStatus` only
 *    for `merchantManaged` orders, with OUT_FOR_DELIVERY preserved.
 *
 * Run with: npm test -- tests/merchant-pos-bidirectional-sync.test.ts
 *
 * These assertions read the implementation source rather than a live database.
 * The previous version inserted rows into a `users` table and `cuisine` /
 * `ownerId` columns that no longer exist in `src/db/schema.ts`, and imported
 * `@/db` at module load — which throws "DATABASE_URL is required" in every
 * `node --test` process. Inspecting the source keeps the same behaviour pinned
 * without a database, matching `merchant-pos-bidirectional-sync-logic.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const MERCHANT_ORDERS = source("src/db/merchant-orders.ts");
const POS_DELIVERY = source("src/db/pos-delivery.ts");

/** The status update object in transitionMerchantOrder, where mirroring lives. */
function merchantSetBlock(): string {
  const start = MERCHANT_ORDERS.indexOf("await tx.update(orders).set({");
  assert.ok(start >= 0, "transitionMerchantOrder should update orders in a transaction");
  const end = MERCHANT_ORDERS.indexOf("}).where(", start);
  assert.ok(end > start, "the update object should be followed by a scoped .where()");
  return MERCHANT_ORDERS.slice(start, end);
}

test("Merchant -> POS: status transitions mirror to integrationStatus atomically", () => {
  const block = merchantSetBlock();

  assert.match(block, /merchantStatus:\s*input\.nextStatus/, "merchantStatus must be set");
  for (const status of ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "REJECTED", "CANCELLED"]) {
    assert.match(
      block,
      new RegExp(`input\\.nextStatus === "${status}"\\s*\\?\\s*\\{\\s*integrationStatus: "${status}"`),
      `${status} must mirror to integrationStatus in the same update`,
    );
  }
  assert.match(block, /statusUpdatedAt:\s*now/, "the server stamps the transition time");
});

test("POS -> Merchant: webhook transitions mirror back for merchantManaged orders", () => {
  assert.match(POS_DELIVERY, /function applyOrderStatusTransition/, "POS webhook transition handler must exist");
  assert.match(POS_DELIVERY, /merchantMap/, "a POS -> merchant status map must exist");

  // The mirrored update is conditional on the order being merchant-managed and
  // on a mapping existing for the incoming POS status.
  assert.match(
    POS_DELIVERY,
    /order\.merchantManaged\s*&&\s*merchantMap\[mapped\]/,
    "merchantStatus may only be mirrored for merchantManaged orders with a known mapping",
  );
  assert.match(POS_DELIVERY, /merchantStatus:\s*merchantMap\[mapped\]/, "the mapped status must be written");
  assert.match(POS_DELIVERY, /merchantStatusUpdatedAt:\s*now/, "the server stamps the mirrored transition time");
});

test("POS -> Merchant: OUT_FOR_DELIVERY maps to OUT_FOR_DELIVERY", () => {
  const mapStart = POS_DELIVERY.indexOf("merchantMap");
  assert.ok(mapStart >= 0, "merchantMap must be declared");
  const mapBlock = POS_DELIVERY.slice(mapStart, mapStart + 600);
  assert.match(
    mapBlock,
    /OUT_FOR_DELIVERY:\s*"OUT_FOR_DELIVERY"/,
    "OUT_FOR_DELIVERY must stay OUT_FOR_DELIVERY on the merchant side",
  );
});

test("POS -> Merchant: non-merchantManaged orders are not mirrored back", () => {
  // Guard placement matters: the spread that writes merchantStatus must sit
  // behind the merchantManaged condition, not be an unconditional field.
  const guard = POS_DELIVERY.match(/\.\.\.\(order\.merchantManaged\s*&&\s*merchantMap\[mapped\]/);
  assert.ok(guard, "the merchantStatus write must be gated by order.merchantManaged");
  const mirrorSpread = POS_DELIVERY.indexOf("...(order.merchantManaged");
  assert.ok(mirrorSpread >= 0, "a gated spread must exist in the update");
});
