import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INTEGRATION_ONE_TIME_PASSKEY_TTL_MS,
  integrationOneTimePasskeyIsLive,
} from "../src/lib/integration-one-time-passkey-core";

test("one-time POS passkeys expire after ten minutes", () => {
  assert.equal(INTEGRATION_ONE_TIME_PASSKEY_TTL_MS, 10 * 60 * 1000);
});

test("one-time POS passkeys are invalid at or after their expiry", () => {
  const now = 1_000_000;
  const expiresAt = new Date(now + INTEGRATION_ONE_TIME_PASSKEY_TTL_MS);

  assert.equal(integrationOneTimePasskeyIsLive(expiresAt, now), true);
  assert.equal(integrationOneTimePasskeyIsLive(expiresAt, expiresAt.getTime() - 1), true);
  assert.equal(integrationOneTimePasskeyIsLive(expiresAt, expiresAt.getTime()), false);
  assert.equal(integrationOneTimePasskeyIsLive(expiresAt, expiresAt.getTime() + 1), false);
  assert.equal(integrationOneTimePasskeyIsLive(null, now), false);
});

test("the owner-only endpoint returns the generated passkey with its expiry", () => {
  const route = readFileSync(
    join(process.cwd(), "src/app/api/partner/integration-passkey/route.ts"),
    "utf8",
  );
  assert.match(route, /requirePartnerSession\(req, \{ mutating: true \}\)/);
  assert.match(route, /passkey: issued\.passkey/);
  assert.match(route, /expiresAt: issued\.expiresAtIso/);
});
