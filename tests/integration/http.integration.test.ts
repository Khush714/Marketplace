/**
 * Phase 5 — integration tests.
 *
 * The security suite in tests/security proves the app REFUSES the wrong things.
 * This suite proves the happy paths still WORK end-to-end: it boots the same
 * real production server (`next start`) against a scratch PostgreSQL database
 * built from the real migrations (see ../security/harness.ts) and drives the
 * public read API the way the storefront does.
 *
 * It deliberately does not duplicate the adversarial cases — those live in the
 * security suite. Run via `npm run test:integration`; like the security suite it
 * skips locally when PostgreSQL is absent and FAILS closed in CI.
 */
import assert from "node:assert/strict";
import { describe, it, before, after, type TestContext } from "node:test";

import { api, getFixture, prepare, resetAndSeed, securityTestsRequired, shutdown } from "../security/harness";

/* Distinct client addresses so these requests never share a rate-limit bucket
 * with any other suite that happens to run against the same class of server. */
const IP = "10.20.0.10";

let harnessReady = false;
let harnessReason = "harness not prepared";

function skipIfUnavailable(t: TestContext): boolean {
  if (harnessReady) return false;
  if (securityTestsRequired()) {
    assert.fail(`integration tests are required in this environment but the harness is unavailable: ${harnessReason}`);
  }
  t.skip(harnessReason);
  return true;
}

before(async () => {
  const r = await prepare();
  harnessReady = r.ok;
  harnessReason = r.reason ?? "harness could not start";
  if (!harnessReady && securityTestsRequired()) {
    throw new Error(`integration tests are required in this environment but the harness could not start: ${harnessReason}`);
  }
});

after(async () => {
  await shutdown();
});

describe("HTTP integration (real Postgres + next start)", () => {
  before(async () => {
    if (harnessReady) await resetAndSeed();
  });

  it("health reports the database round-trips", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/health", ip: IP });
    assert.equal(res.status, 200);
    assert.equal(res.json?.ok, true);
  });

  it("browse returns a page object with a cursor field", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/restaurants", ip: IP });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json?.restaurants), "restaurants must be an array");
    assert.ok("nextCursor" in (res.json ?? {}), "browse must expose nextCursor");
  });

  it("a listing profile resolves by slug", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/restaurants/alpha-kitchen", ip: IP });
    assert.equal(res.status, 200);
    const restaurant = (res.json?.restaurant ?? {}) as { slug?: string };
    assert.equal(restaurant.slug, "alpha-kitchen");
    assert.ok(Array.isArray(res.json?.sections), "profile must carry menu sections");
  });

  it("an unknown slug is a structured 404", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/restaurants/no-such-listing", ip: IP });
    assert.equal(res.status, 404);
    const error = res.json?.error as { code?: string } | undefined;
    assert.equal(error?.code, "NOT_FOUND");
  });

  it("search returns a results array", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/search?q=alpha", ip: IP });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json?.results), "search must return a results array");
  });

  it("a signed order token yields the customer-safe projection", async (t) => {
    if (skipIfUnavailable(t)) return;
    const order = getFixture().alphaOpen;
    const res = await api({
      path: `/api/orders/${order.code}`,
      ip: IP,
      headers: { "x-order-token": order.orderToken },
    });
    assert.equal(res.status, 200);
    const publicOrder = res.json?.order as Record<string, unknown> | undefined;
    assert.ok(publicOrder, "expected a public order object");
    assert.equal(publicOrder.code, order.code);
    // The projection must never leak identifiers or contact details.
    for (const forbidden of ["id", "phone", "externalOrderId", "restaurantId"]) {
      assert.ok(!(forbidden in publicOrder), `public order must not expose ${forbidden}`);
    }
  });

  it("an order without its token is a structured 404", async (t) => {
    if (skipIfUnavailable(t)) return;
    const order = getFixture().alphaOpen;
    const res = await api({ path: `/api/orders/${order.code}`, ip: IP });
    assert.equal(res.status, 404);
    const error = res.json?.error as { code?: string } | undefined;
    assert.equal(error?.code, "NOT_FOUND");
  });
});
