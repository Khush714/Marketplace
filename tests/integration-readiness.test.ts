/**
 * Regression tests for the single definition of "can this restaurant take an
 * order".
 *
 * Run with: npm test
 *
 * This rule used to exist in four places — a boolean in `hasActiveIntegration`,
 * a string-returning copy beside it, one in each delivery bridge, an inline
 * check in `resolveOutletForRestaurant`, and hard-coded "ACTIVE" in the partner
 * console. They disagreed: the claim flow sets `status = 'active'` without
 * sealing a webhook secret, so a record could read ACTIVE while delivery
 * refused to POST. Customers were charged and the order sat at PAYMENT_PENDING
 * forever.
 *
 * The tests below pin the precedence, because precedence is the part that is
 * easy to "fix" wrongly: reporting `webhook_secret` when the record is not even
 * active yet sends the restaurant to reconnect a POS that was never claimed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canDeliverToPos,
  integrationReadiness,
} from "../src/integrations/pos/readiness";

/** A fully wired POS integration — the only shape that may take orders. */
const CONNECTED = {
  status: "active",
  posRestaurantId: "rest_7",
  webhookSecret: "sealed:v1:abc",
};

test("a fully connected POS is ready", () => {
  assert.deepEqual(integrationReadiness(CONNECTED), {
    ready: true,
    notReadyReason: null,
  });
  assert.equal(canDeliverToPos(CONNECTED), true);
});

test("an ACTIVE record with no webhook secret is NOT ready", () => {
  // The exact shape the claim flow produces: active, routable, but no secret to
  // sign with. This is the case that shipped as "ACTIVE" in the partner UI.
  const rec = { status: "active", posRestaurantId: "rest_7", webhookSecret: null };
  assert.deepEqual(integrationReadiness(rec), {
    ready: false,
    notReadyReason: "webhook_secret",
  });
  assert.equal(canDeliverToPos(rec), false);
});

test("an absent integration record is inactive, not a missing secret", () => {
  // `hasActiveIntegration` passes `{}` when the join finds no row at all.
  const { ready, notReadyReason } = integrationReadiness({});
  assert.equal(ready, false);
  assert.equal(notReadyReason, "inactive");
});

test("null fields mean the same as absent ones", () => {
  assert.equal(canDeliverToPos(null as never), false);
  assert.equal(integrationReadiness(null as never).notReadyReason, "inactive");
});

test("reasons are reported most-fundamental-first", () => {
  // Not yet claimed at all — telling this restaurant to fix its webhook secret
  // would send them to reconnect a POS they never connected.
  assert.equal(
    integrationReadiness({ status: "pending", posRestaurantId: null, webhookSecret: null })
      .notReadyReason,
    "inactive",
  );
  // Claimed and active but unroutable: name the id, not the secret.
  assert.equal(
    integrationReadiness({ status: "active", posRestaurantId: null, webhookSecret: null })
      .notReadyReason,
    "pos_restaurant_id",
  );
});

test("any status other than exactly 'active' blocks orders", () => {
  // Deliberately strict: the bridge used to accept a truthy status, so a
  // half-finished state like 'PENDING' could pass the gate.
  for (const status of ["pending", "revoked", "error", "ACTIVE", "", null, undefined]) {
    const rec = { ...CONNECTED, status: status as string };
    assert.equal(canDeliverToPos(rec), false, `status ${String(status)} must not be ready`);
    assert.equal(integrationReadiness(rec).notReadyReason, "inactive");
  }
});

test("an empty-string id or secret does not count as present", () => {
  // A blank column is what a half-finished upsert can leave behind, and
  // `""` is truthy-adjacent enough to slip past a naive `if (!x)` on some paths.
  assert.equal(
    integrationReadiness({ ...CONNECTED, posRestaurantId: "" }).notReadyReason,
    "pos_restaurant_id",
  );
  assert.equal(
    integrationReadiness({ ...CONNECTED, webhookSecret: "" }).notReadyReason,
    "webhook_secret",
  );
});

test("reason and ready can never disagree", () => {
  const shapes = [
    {},
    { status: "active" },
    { status: "active", posRestaurantId: "rest_7" },
    { status: "active", webhookSecret: "sealed:v1:abc" },
    { status: "pending", posRestaurantId: "rest_7", webhookSecret: "sealed:v1:abc" },
    CONNECTED,
  ];
  for (const rec of shapes) {
    const { ready, notReadyReason } = integrationReadiness(rec);
    assert.equal(ready, notReadyReason === null, `mismatch for ${JSON.stringify(rec)}`);
    // canDeliverToPos is the same rule, narrowed — it must never disagree either.
    assert.equal(canDeliverToPos(rec), ready);
  }
});