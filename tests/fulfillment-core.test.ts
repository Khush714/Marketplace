import { test } from "node:test";
import assert from "node:assert/strict";

import { selectMarketplaceFulfillment } from "../src/lib/fulfillment-core";

test("paired Merchant is the exclusive fulfillment destination when present", () => {
  assert.equal(selectMarketplaceFulfillment({ posReady: true, merchantReady: true }), "merchant");
  assert.equal(selectMarketplaceFulfillment({ posReady: false, merchantReady: true }), "merchant");
  assert.equal(selectMarketplaceFulfillment({ posReady: true, merchantReady: false }), "pos");
  assert.equal(selectMarketplaceFulfillment({ posReady: false, merchantReady: false }), "none");
});
