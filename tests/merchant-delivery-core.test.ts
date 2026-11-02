import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canTransitionMerchantDelivery,
  isMerchantDeliveryStatus,
  isMerchantDeliveryMode,
  MERCHANT_DELIVERY_STATUSES,
  MERCHANT_DELIVERY_MODES,
} from "../src/lib/merchant-delivery-core";

test("Merchant delivery modes accept the supported manual courier options", () => {
  for (const mode of MERCHANT_DELIVERY_MODES) {
    assert.equal(isMerchantDeliveryMode(mode), true);
  }
});

test("delivery completion requires a supported courier mode", () => {
  assert.equal(isMerchantDeliveryMode(null), false);
  assert.equal(isMerchantDeliveryMode(undefined), false);
  assert.equal(isMerchantDeliveryMode("unknown"), false);
});

test("manual delivery accepts only known statuses and forward transitions", () => {
  for (const status of MERCHANT_DELIVERY_STATUSES) {
    assert.equal(isMerchantDeliveryStatus(status), true);
  }
  assert.equal(isMerchantDeliveryStatus("in_transit"), false);
  assert.equal(canTransitionMerchantDelivery("pending", "assigned"), true);
  assert.equal(canTransitionMerchantDelivery("assigned", "picked_up"), true);
  assert.equal(canTransitionMerchantDelivery("picked_up", "delivered"), true);
  assert.equal(canTransitionMerchantDelivery("pending", "picked_up"), false);
  assert.equal(canTransitionMerchantDelivery("delivered", "assigned"), false);
});
