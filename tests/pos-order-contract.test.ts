/**
 * Regression tests for the POS order-lifecycle boundary.
 *
 * Run with: npm test
 *
 * These cover the two silent-data-loss bugs found by the signed round trip:
 *  1. `order.rejected` / `order.cancelled` carry no `status` field, so mapping
 *     from `status` alone answered 200 `{skipped: MISSING_FIELDS}` — the POS
 *     marked the event delivered, the transition never applied, and the
 *     cancellation refund never fired.
 *  2. Modifiers were sent in a sibling `modifiers` array the POS discards on
 *     ingest, so kitchen tickets lost the customer's actual selection.
 *
 * The assertions are pinned against the POS source, not against intent — see the
 * line references in each comment.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mapPosEventToMarketplaceStatus } from "../src/integrations/pos/order-status";
import { isOnlinePaymentMethod, posItemName } from "../src/integrations/pos/order-payload-shape";

test("order.cancelled resolves to CANCELLED without a status field", () => {
  // status.js:397 — deliverWebhook({ ..., event: 'order.cancelled' }) with no status.
  assert.equal(mapPosEventToMarketplaceStatus("order.cancelled", undefined), "CANCELLED");
  assert.equal(mapPosEventToMarketplaceStatus("order.cancelled", null), "CANCELLED");
});

test("order.rejected resolves to REJECTED without a status field", () => {
  // status.js:386 — the reject frame also omits status.
  assert.equal(mapPosEventToMarketplaceStatus("order.rejected", undefined), "REJECTED");
});

test("order.accepted resolves from the event name", () => {
  assert.equal(mapPosEventToMarketplaceStatus("order.accepted", undefined), "ACCEPTED");
});

test("order.status_changed still maps the POS status vocabulary", () => {
  // These events DO send status; the POS's own words must survive.
  assert.equal(mapPosEventToMarketplaceStatus("order.status_changed", "Ready"), "READY");
  assert.equal(mapPosEventToMarketplaceStatus("order.status_changed", "Out for Delivery"), "OUT_FOR_DELIVERY");
  assert.equal(mapPosEventToMarketplaceStatus("order.status_changed", "Preparing"), "PREPARING");
});

test("the event name wins over a conflicting status field", () => {
  // A cancel frame that also carries a stale status must still land on CANCELLED.
  assert.equal(mapPosEventToMarketplaceStatus("order.cancelled", "Preparing"), "CANCELLED");
});

test("unknown events do not invent a status", () => {
  // Converges as MISSING_FIELDS at the handler rather than guessing.
  assert.equal(mapPosEventToMarketplaceStatus("order.teleported", undefined), null);
  assert.equal(mapPosEventToMarketplaceStatus("order.teleported", "Definitely Ready"), null);
  assert.equal(mapPosEventToMarketplaceStatus(null, undefined), null);
});

test("modifiers fold into the item name", () => {
  assert.equal(
    posItemName({ name: "Paneer Tikka", modifiers: [{ name: "Large", quantity: 1, priceCents: 0, optionId: 1 }] }),
    "Paneer Tikka (Large)",
  );
  assert.equal(
    posItemName({
      name: "Paneer Tikka",
      modifiers: [
        { name: "Large", quantity: 1, priceCents: 0, optionId: 1 },
        { name: "Extra Cheese", quantity: 1, priceCents: 0, optionId: 2 },
      ],
    }),
    "Paneer Tikka (Large, Extra Cheese)",
  );
});

test("a repeated modifier keeps its count", () => {
  assert.equal(
    posItemName({ name: "Masala Dosa", modifiers: [{ name: "Extra Cheese", quantity: 2, priceCents: 0, optionId: 1 }] }),
    "Masala Dosa (2x Extra Cheese)",
  );
});

test("an item with no modifiers is untouched", () => {
  assert.equal(posItemName({ name: "Paneer Tikka", modifiers: [] }), "Paneer Tikka");
  assert.equal(posItemName({ name: "Paneer Tikka" }), "Paneer Tikka");
});

test("every online method the POS captures is treated as settled", () => {
  // Mirrors METHOD_OVERRIDE (payments.js:71) minus the cash family.
  for (const m of ["upi", "card", "netbanking", "wallet", "emi", "paylater"]) {
    assert.equal(isOnlinePaymentMethod(m), true, `${m} must ride as PAID`);
  }
  assert.equal(isOnlinePaymentMethod("UPI"), true, "matching must be case-insensitive");
  assert.equal(isOnlinePaymentMethod(" Card "), true, "matching must trim");
});

test("cash and COD stay collect-in-person", () => {
  for (const m of ["cash", "cod", "COD"]) {
    assert.equal(isOnlinePaymentMethod(m), false, `${m} must ride as COD`);
  }
  assert.equal(isOnlinePaymentMethod(null), false);
  assert.equal(isOnlinePaymentMethod(undefined), false);
  assert.equal(isOnlinePaymentMethod("cheque"), false, "unknown methods must not be assumed paid");
});
