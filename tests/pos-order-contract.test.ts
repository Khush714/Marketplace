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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mapPosEventToMarketplaceStatus, hasStartedPreparing, isCancellable } from "../src/integrations/pos/order-status";
import { isClearedForPos, isOnlinePaymentMethod, posItemName } from "../src/integrations/pos/order-payload-shape";

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

test("an online order is cleared for the POS only once its money is captured", () => {
  // The payload labels every online order `payment_status: "PAID"`, so any
  // online order that is not yet paid must never reach the kitchen. The only
  // cleared status is a captured one.
  assert.equal(isClearedForPos({ paymentMethod: "upi", paymentStatus: "PAID" }), true);
  for (const status of ["UNPAID", "PAYMENT_PENDING", "PAYMENT_CANCELLED", "FAILED", "REFUND_PENDING", "REFUNDED"]) {
    assert.equal(
      isClearedForPos({ paymentMethod: "netbanking", paymentStatus: status }),
      false,
      `online ${status} must not be processed`,
    );
  }
});

test("cash and COD are always cleared (collection is in person)", () => {
  for (const m of ["cash", "cod", "COD"]) {
    for (const status of ["UNPAID", "PAYMENT_PENDING", "PAID"]) {
      assert.equal(isClearedForPos({ paymentMethod: m, paymentStatus: status }), true, `${m}/${status}`);
    }
  }
});

test("both POS delivery gates fail closed on an unpaid online order", () => {
  // Pinned to the two choke points that can put an order in the kitchen: the
  // durability journal (enqueue) and the send path (attempt). Both must consult
  // `isClearedForPos` before any kitchen-visible side effect.
  const readSrc = (rel: string) => readFileSync(join(__dirname, "..", "src", rel), "utf8");

  const enqueue = readSrc("db/pos-delivery.ts");
  assert.match(enqueue, /isClearedForPos\(/, "enqueueOrderDelivery must consult the fail-closed gate");
  const enqueueBodyStart = enqueue.indexOf("export async function enqueueOrderDelivery");
  assert.ok(
    enqueueBodyStart !== -1 && enqueue.indexOf("isClearedForPos(", enqueueBodyStart) !== -1,
    "the gate must sit inside enqueueOrderDelivery",
  );

  const bridge = readSrc("integrations/pos/order-bridge.ts");
  const attemptBody = bridge.slice(bridge.indexOf("export async function attemptPosDelivery"));
  assert.ok(
    attemptBody.indexOf("isClearedForPos(") !== -1,
    "attemptPosDelivery must consult the fail-closed gate",
  );
  assert.ok(
    attemptBody.indexOf("isClearedForPos(") < attemptBody.indexOf("postPosOrderIngest("),
    "the gate must run before the POS HTTP call",
  );
});

test("the kitchen counts as preparing from PREPARING onwards", () => {
  for (const s of ["PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"]) {
    assert.equal(hasStartedPreparing(s), true, `${s} must count as preparing`);
  }
  for (const s of ["PLACED", "ACCEPTED"]) {
    assert.equal(hasStartedPreparing(s), false, `${s} must count as not preparing`);
  }
});

test("an order is cancellable exactly until the kitchen starts preparing", () => {
  // The guarantee: cancellation works while the food has NOT started preparing
  // (PLACED / ACCEPTED). Once PREPARING hits, it is cook-locked.
  for (const s of ["PLACED", "ACCEPTED"]) {
    assert.equal(isCancellable(s), true, `${s} must stay cancellable`);
  }
  for (const s of ["PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REJECTED"]) {
    assert.equal(isCancellable(s), false, `${s} must not be cancellable`);
  }
  assert.equal(isCancellable("PREPARING"), false);
});

test("the cancellation window is enforced identically by UI and route", () => {
  // Both the tracking screen (`queries.ts` cancellable flag) and the cancel
  // endpoint (`order-cancel.ts`) must derive from the same pure helper, so a
  // button can never be shown that the API refuses, or vice versa.
  const readSrc = (rel: string) => readFileSync(join(__dirname, "..", "src", rel), "utf8");

  const queries = readSrc("db/queries.ts");
  const integrationBlock = queries.slice(queries.indexOf("function integrationOrderStatus"));
  assert.match(integrationBlock, /isCancellable\(/, "the UI cancellable flag must use isCancellable");

  const cancel = readSrc("integrations/pos/order-cancel.ts");
  assert.match(cancel, /hasStartedPreparing\(/, "the route must fail closed once cooking starts");
  assert.match(cancel, /isCancellable\(/, "the route must use the shared cancellable rule");
  assert.match(cancel, /cancelOrderBeforeHandoff\(/, "the route must cancel pre-handoff orders locally");
  assert.ok(
    cancel.indexOf("hasStartedPreparing(") < cancel.indexOf("fetch("),
    "the fail-closed gate must run before any POS HTTP call",
  );
});
