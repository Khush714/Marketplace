import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isMerchantBusinessId,
  isMerchantPairingPasskey,
  merchantPairingSecretMatches,
} from "../src/lib/merchant-integration-core";

test("Merchant integration auth compares exact high-entropy secrets", () => {
  const secret = "a".repeat(43);
  assert.equal(merchantPairingSecretMatches(secret, secret), true);
  assert.equal(merchantPairingSecretMatches(`${secret}b`, secret), false);
  assert.equal(merchantPairingSecretMatches("b".repeat(43), secret), false);
  assert.equal(merchantPairingSecretMatches("short", "short"), false);
});

test("Merchant pairing accepts only UUID business IDs and 24-character passkeys", () => {
  assert.equal(isMerchantBusinessId("a1b2c3d4-e5f6-4789-a012-3456789abcde"), true);
  assert.equal(isMerchantBusinessId("not-a-uuid"), false);
  assert.equal(isMerchantPairingPasskey("A".repeat(24)), true);
  assert.equal(isMerchantPairingPasskey("A".repeat(23)), false);
  assert.equal(isMerchantPairingPasskey("A".repeat(23) + "!"), false);
});
