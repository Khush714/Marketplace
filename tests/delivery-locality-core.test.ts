/**
 * Checkout delivery-area admission. The selected locality and the address's
 * pincode are claims, not GPS proof, but they must never contradict the
 * restaurant's own served locality. Legacy carts without either signal still
 * pass so seeded/local flows are not broken by this admission check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { knownLocalityKey, resolveDeliveryLocality } from "../src/lib/delivery-locality-core";

test("known locality keys are accepted case-insensitively", () => {
  assert.equal(knownLocalityKey(" Old-City "), "old-city");
  assert.equal(knownLocalityKey("nowhere"), null);
  assert.equal(knownLocalityKey(42), null);
});

test("the selected locality must match the restaurant's served locality", () => {
  assert.deepEqual(
    resolveDeliveryLocality({
      localityKey: "old-city",
      restaurantLocality: "Old City",
      addressText: "Somewhere",
    }),
    { ok: true, localityKey: "old-city", verified: true },
  );

  const rejected = resolveDeliveryLocality({
    localityKey: "zadeshwar",
    restaurantLocality: "Old City",
    addressText: "Somewhere",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.code, "OUTSIDE_SERVICE_AREA");
    assert.match(rejected.error, /does not deliver to Zadeshwar/);
  }
});

test("a mismatched address pincode is rejected even without a locality claim", () => {
  const rejected = resolveDeliveryLocality({
    restaurantLocality: "Old City",
    addressText: "Flat 4, Zadeshwar, 392011",
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /392011/);
});

test("a matching pincode verifies the delivery area", () => {
  assert.deepEqual(
    resolveDeliveryLocality({
      restaurantLocality: "Maktampur",
      addressText: "Shop 12, 392012",
    }),
    { ok: true, localityKey: "maktampur", verified: true },
  );
});

test("an address-only legacy cart stays unverified rather than being blocked", () => {
  assert.deepEqual(
    resolveDeliveryLocality({
      restaurantLocality: "Old City",
      addressText: "Near the old bridge",
    }),
    { ok: true, localityKey: null, verified: false },
  );
});

test("the URL locality claim is used only when the body has no selection", () => {
  const fromUrl = resolveDeliveryLocality({
    urlLocalityKey: "old-city",
    restaurantLocality: "Old City",
    addressText: "Somewhere",
  });
  assert.equal(fromUrl.ok, true);

  const bodyWins = resolveDeliveryLocality({
    localityKey: "maktampur",
    urlLocalityKey: "old-city",
    restaurantLocality: "Maktampur",
    addressText: "Somewhere",
  });
  assert.equal(bodyWins.ok, true);
});
