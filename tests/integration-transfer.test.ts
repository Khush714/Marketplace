/**
 * Regression tests for POS identity (`marketplace_id`) transfer approval.
 *
 * Run with: npm test
 *
 * `restaurants.marketplace_id` is UNIQUE, so a POS reconnecting under a new
 * listing while its identity is still held elsewhere fails the claim with
 * MARKETPLACE_ID_TAKEN. That refusal fired *after* the POS redeemed its
 * single-use connection code, so the operator was left with a burned code and
 * the only recovery was an engineer editing `restaurants` by hand.
 *
 * These pin the conditions under which an identity may move. Every branch here
 * either releases a live restaurant or hands its identity to another listing,
 * so the rules are asserted directly rather than inferred from a route's
 * behaviour.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planTransferApproval,
  shouldActivateOnApproval,
  type TransferStateSnapshot,
} from "../src/lib/integration-transfer";

const REQUEST = {
  id: 7,
  requestedByRestaurantId: 241,
  previousRestaurantId: 212,
  marketplaceId: "rst_aarfUS9gEjFevjgE",
  status: "pending",
};

/** A clean, unremarkable snapshot: no traffic on the losing listing, no records. */
function snapshot(over: Partial<TransferStateSnapshot> = {}): TransferStateSnapshot {
  return {
    request: REQUEST,
    currentHolderId: REQUEST.previousRestaurantId,
    requesterMarketplaceId: null,
    requesterRecord: { status: "pending", posRestaurantId: REQUEST.marketplaceId },
    holderRecord: { status: "disabled", posRestaurantId: REQUEST.marketplaceId },
    holderStats: { orders: 0, openOrders: 0 },
    ...over,
  };
}

test("a pending request for a still-held identity is approved", () => {
  const plan = planTransferApproval(snapshot());
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.grantMarketplaceIdTo, 241);
  assert.equal(plan.releaseFromRestaurantId, 212);
  assert.equal(plan.marketplaceId, "rst_aarfUS9gEjFevjgE");
  assert.equal(plan.warnings.length, 0);
});

test("a decided request is stale, not refused on the merits", () => {
  for (const status of ["approved", "denied"]) {
    const plan = planTransferApproval(snapshot({ request: { ...REQUEST, status } }));
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.code, "TRANSFER_NOT_PENDING");
  }
});

test("a request is refused once the identity is unheld, and says to reconnect", () => {
  const plan = planTransferApproval(snapshot({ currentHolderId: null }));
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, "IDENTITY_UNCLAIMED");
  // The recovery is a clean claim, not another transfer: with nothing holding the
  // id there is no conflict left to arbitrate.
  assert.match(plan.error, /reconnect/i);
});

test("a request is refused when a third listing now holds the identity", () => {
  const plan = planTransferApproval(snapshot({ currentHolderId: 999 }));
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, "HOLDER_CHANGED");
  // Must not name the wrong holder as the loser.
  assert.doesNotMatch(plan.error, /\b212\b/);
});

test("an already-granted request reports success rather than re-running", () => {
  const plan = planTransferApproval(
    snapshot({ requesterMarketplaceId: REQUEST.marketplaceId }),
  );
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, "ALREADY_GRANTED");
});

test("approving warns before closing a live listing that still takes orders", () => {
  const plan = planTransferApproval(
    snapshot({
      holderRecord: { status: "active", posRestaurantId: REQUEST.marketplaceId },
      holderStats: { orders: 14, openOrders: 2 },
    }),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const joined = plan.warnings.join(" ");
  assert.match(joined, /ACTIVE/);
  assert.match(joined, /2 orders are still mid-flight/);
  assert.match(joined, /14 lifetime orders/);
});

test("a single open order reads as singular", () => {
  const plan = planTransferApproval(snapshot({ holderStats: { orders: 1, openOrders: 1 } }));
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.match(plan.warnings.join(" "), /1 order is still mid-flight/);
});

test("a stale holder record on the losing listing is called out", () => {
  const plan = planTransferApproval(
    snapshot({ holderRecord: { status: "disabled", posRestaurantId: "rst_someoneElse" } }),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.match(plan.warnings.join(" "), /already stale/);
});

test("replacing an already-active requester is warned about, not blocked", () => {
  const plan = planTransferApproval(
    snapshot({
      requesterRecord: { status: "active", posRestaurantId: "rst_someOtherIdentity" },
    }),
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.match(plan.warnings.join(" "), /already ACTIVE on another identity/);
});

test("approval activates a record only once it has an id and a secret", () => {
  assert.equal(
    shouldActivateOnApproval({
      status: "pending",
      posRestaurantId: "rst_aarfUS9gEjFevjgE",
      hasWebhookSecret: true,
    }),
    true,
  );
  // Moving the id does not mint secrets, so a record still missing one must stay
  // closed rather than opening checkout for orders that cannot be signed.
  assert.equal(
    shouldActivateOnApproval({
      status: "pending",
      posRestaurantId: "rst_aarfUS9gEjFevjgE",
      hasWebhookSecret: false,
    }),
    false,
  );
  assert.equal(
    shouldActivateOnApproval({
      status: "pending",
      posRestaurantId: null,
      hasWebhookSecret: true,
    }),
    false,
  );
});

test("a record the owner turned off is never reactivated by a transfer", () => {
  assert.equal(
    shouldActivateOnApproval({
      status: "disabled",
      posRestaurantId: "rst_aarfUS9gEjFevjgE",
      hasWebhookSecret: true,
    }),
    false,
  );
});
