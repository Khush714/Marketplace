/**
 * Phase 13 — automated security tests (end-to-end).
 *
 * Exercises the security decisions the app makes at the HTTP boundary against
 * a scratch database and a real `next start` server (see ./harness.ts). The
 * harness needs local PostgreSQL at 127.0.0.1:5432 (postgres/postgres); when it
 * is absent every case here skips, so the plain `npm test` stays green elsewhere.
 *
 * One file on purpose: `node --test` runs test files in separate processes, and
 * every suite below contends on one server, one database and the server's
 * in-process rate limiters, so splitting them across files would race.
 */
import assert from "node:assert/strict";
import { describe, it, before, after, type TestContext } from "node:test";

import {
  api,
  ALPHA_OWNER_KEY,
  BETA_OWNER_KEY,
  csrfHeaders,
  expireIntegrationSession,
  getFixture,
  hmacSha256Hex,
  jarFrom,
  loginPartner,
  makeSecretToken,
  makeTrackingToken,
  OPS_TOKEN,
  prepare,
  queryRow,
  queryRows,
  resetAndSeed,
  revokeIntegrationSession,
  seedConnectionCode,
  seedOrder,
  seedPayment,
  seedRestaurant,
  seedSession,
  shutdown,
  WEBHOOK_SECRET,
} from "./harness";

/* Dedicated per-suite client addresses so rate-limit buckets never cross. */
const IPS = {
  admin: "10.0.3.10",
  auth: "10.0.2.10",
  iso: "10.0.4.10",
  order: "10.0.9.10",
  enumeration: "10.0.9.11",
  code: "10.0.8.10",
  delete: "10.0.7.10",
  integration: "10.0.5.10",
  payment: "10.0.6.10",
} as const;

let harnessReady = false;
let harnessReason = "harness not prepared";

function skipIfUnavailable(t: TestContext): boolean {
  if (!harnessReady) {
    t.skip(harnessReason);
    return true;
  }
  return false;
}

before(async () => {
  const r = await prepare();
  harnessReady = r.ok;
  harnessReason = r.reason ?? "harness could not start";
});

after(async () => {
  await shutdown();
});

/* ---------------------------------------------------------------- helpers */

/** The public-order object from an order/tracking response. */
function publicOrder(
  resJson: Record<string, unknown> | null,
): Record<string, unknown> {
  const candidate = resJson?.order;
  assert.ok(candidate && typeof candidate === "object", "expected a JSON order object");
  return candidate as Record<string, unknown>;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/* ================================================ 1. ops admin auth ====== */

describe("ops admin authentication (delivery ops tokens)", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  it("refuses the ops code minting route with no token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/partner/codes", method: "GET", ip: IPS.admin });
    assert.equal(res.status, 401);
  });

  it("refuses it with a wrong token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({
      path: "/api/partner/codes",
      method: "GET",
      ip: IPS.admin,
      headers: { "x-ops-token": "wrong-token" },
    });
    assert.equal(res.status, 401);
  });

  it("lists the mints with the correct token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({
      path: "/api/partner/codes",
      method: "GET",
      ip: IPS.admin,
      headers: { "x-ops-token": OPS_TOKEN },
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json?.codes), "expected a codes array");
    assert.equal((res.json?.codes as unknown[]).length, 5, "expected the five seeded connection codes");
  });

  it("keeps the connection listing ops-only", async (t) => {
    if (skipIfUnavailable(t)) return;
    const denied = await api({ path: "/api/partner/connect", method: "GET", ip: IPS.admin });
    assert.equal(denied.status, 401);
    const allowed = await api({
      path: "/api/partner/connect",
      method: "GET",
      ip: IPS.admin,
      headers: { "x-ops-token": OPS_TOKEN },
    });
    assert.equal(allowed.status, 200);
    assert.ok(Array.isArray(allowed.json?.connections), "expected a connections array");
  });
});

/* ================================== 2. partner session lifecycle ========== */

describe("partner session lifecycle (connect, expiry, revocation, sign-out)", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  it("refuses an unauthenticated partner request", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.auth });
    assert.equal(res.status, 401);
  });

  it("refuses a wrong owner key with 404 (no existence oracle)", async (t) => {
    if (skipIfUnavailable(t)) return;
    const { result } = await loginPartner("not-a-real-key", IPS.auth);
    assert.equal(result.status, 404);
  });

  it("exchanges a valid owner key for a live session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const { result, jar } = await loginPartner(f.alpha.ownerKey, IPS.auth);
    assert.equal(result.status, 200);
    assert.ok(jar["crave_restaurant_session"], "session cookie set");
    assert.ok(jar["crave_restaurant_csrf"], "csrf cookie set");
    const who = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.auth, jar });
    assert.equal(who.status, 200);
    assert.equal((who.json?.restaurant as Record<string, unknown> | undefined)?.name, f.alpha.name);
  });

  it("refuses a write without the CSRF token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const { jar } = await loginPartner(f.alpha.ownerKey, IPS.auth);
    const res = await api({
      path: "/api/partner/restaurant",
      method: "PATCH",
      ip: IPS.auth,
      jar,
      body: { active: false },
    });
    assert.equal(res.status, 403);
  });

  it("sign-out revokes the session server-side", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const { jar } = await loginPartner(f.alpha.ownerKey, IPS.auth);
    const out = await api({
      path: "/api/partner/session",
      method: "DELETE",
      ip: IPS.auth,
      jar,
      headers: csrfHeaders(jar),
    });
    assert.equal(out.status, 200);
    const who = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.auth, jar });
    assert.equal(who.status, 401);
  });

  it("refuses an expired session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const token = makeSecretToken();
    const csrf = makeSecretToken();
    await seedSession({ restaurantId: f.alpha.id, token, csrf, expiresAtMs: Date.now() - 5_000 });
    const res = await api({
      path: "/api/partner/restaurant",
      method: "GET",
      ip: IPS.auth,
      jar: jarFrom({ token, csrf }),
    });
    assert.equal(res.status, 401);
  });

  it("refuses a revoked session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const token = makeSecretToken();
    const csrf = makeSecretToken();
    await seedSession({ restaurantId: f.alpha.id, token, csrf, revokedAtMs: Date.now() });
    const res = await api({
      path: "/api/partner/restaurant",
      method: "GET",
      ip: IPS.auth,
      jar: jarFrom({ token, csrf }),
    });
    assert.equal(res.status, 401);
  });
});

/* ================================= 3. authorization isolation ============ */

describe("restaurant A/B authorization isolation", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  it("each session can only read its own listing", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const a = await loginPartner(f.alpha.ownerKey, IPS.iso);
    const b = await loginPartner(f.beta.ownerKey, IPS.iso);
    assert.equal(a.result.status, 200);
    assert.equal(b.result.status, 200);
    const aWho = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.iso, jar: a.jar });
    const bWho = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.iso, jar: b.jar });
    assert.equal((aWho.json?.restaurant as Record<string, unknown> | undefined)?.name, f.alpha.name);
    assert.equal((bWho.json?.restaurant as Record<string, unknown> | undefined)?.name, f.beta.name);
  });

  it("a partner session can edit only its own listing", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const a = await loginPartner(f.alpha.ownerKey, IPS.iso);
    const b = await loginPartner(f.beta.ownerKey, IPS.iso);
    const edit = await api({
      path: "/api/partner/restaurant",
      method: "PATCH",
      ip: IPS.iso,
      jar: a.jar,
      headers: csrfHeaders(a.jar),
      body: {
        profile: {
          name: "Alpha Renamed",
          tagline: "Renamed in the isolation test",
          cuisines: ["Biryani"],
          locality: "Old City",
        },
      },
    });
    assert.equal(edit.status, 200);
    const bWho = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.iso, jar: b.jar });
    assert.equal((bWho.json?.restaurant as Record<string, unknown> | undefined)?.name, f.beta.name);
  });

  it("a partner session cannot mint connection codes", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const a = await loginPartner(f.alpha.ownerKey, IPS.iso);
    const get = await api({ path: "/api/partner/codes", method: "GET", ip: IPS.iso, jar: a.jar });
    const post = await api({
      path: "/api/partner/codes",
      method: "POST",
      ip: IPS.iso,
      jar: a.jar,
      headers: csrfHeaders(a.jar),
      body: { days: 1 },
    });
    assert.equal(get.status, 401);
    assert.equal(post.status, 401);
  });

  it("a partner session cannot list POS connections", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const a = await loginPartner(f.alpha.ownerKey, IPS.iso);
    const res = await api({ path: "/api/partner/connect", method: "GET", ip: IPS.iso, jar: a.jar });
    assert.equal(res.status, 401);
  });

  it("an integration bearer token is not an admin credential", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const login = await api({
      path: "/api/integration/login",
      method: "POST",
      ip: IPS.integration,
      body: { code: f.codes.login, passkey: f.alpha.ownerKey },
    });
    assert.equal(login.status, 200);
    const token = (login.json?.["token"] as string) ?? "";
    const res = await api({
      path: "/api/partner/codes",
      method: "GET",
      ip: IPS.iso,
      headers: bearer(token),
    });
    assert.equal(res.status, 401);
  });
});

/* ============================= 4. order privacy + enumeration ============ */

describe("order privacy and tracking enumeration protection", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  it("returns a public projection for a valid order code + token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const res = await api({
      path: `/api/orders/${f.alphaOpen.code}`,
      method: "GET",
      ip: IPS.order,
      headers: { "x-order-token": f.alphaOpen.orderToken },
    });
    assert.equal(res.status, 200);
    const order = publicOrder(res.json);
    assert.equal(order["code"], f.alphaOpen.code);
    assert.equal(order["restaurantSlug"], f.alpha.slug);
    for (const secret of ["phone", "id", "restaurantId", "externalOrderId", "posConnected"]) {
      assert.equal(secret in order, false, `${secret} must not be in the public order`);
    }
  });

  it("refuses a valid order code without the token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const res = await api({ path: `/api/orders/${f.alphaOpen.code}`, method: "GET", ip: IPS.order });
    assert.equal(res.status, 404);
  });

  it("refuses a valid order code with a wrong token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const res = await api({
      path: `/api/orders/${f.alphaOpen.code}`,
      method: "GET",
      ip: IPS.order,
      headers: { "x-order-token": "wrong-order-token" },
    });
    assert.equal(res.status, 404);
  });

  it("returns the same public projection for a valid tracking token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const res = await api({
      path: `/api/orders/track/${f.alphaOpen.trackingToken}`,
      method: "GET",
      ip: IPS.order,
    });
    assert.equal(res.status, 200);
    const order = publicOrder(res.json);
    assert.equal(order["code"], f.alphaOpen.code);
    assert.equal("phone" in order, false);
  });

  it("refuses a malformed tracking token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/orders/track/zz", method: "GET", ip: IPS.order });
    assert.equal(res.status, 404);
  });

  it("refuses a well-formed unknown tracking token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({
      path: `/api/orders/track/${makeTrackingToken()}`,
      method: "GET",
      ip: IPS.order,
    });
    assert.equal(res.status, 404);
  });

  it("rate-limits tracking-token enumeration", async (t) => {
    if (skipIfUnavailable(t)) return;
    const statuses: number[] = [];
    for (let i = 0; i < 61; i += 1) {
      const res = await api({
        path: `/api/orders/track/${makeTrackingToken()}`,
        method: "GET",
        ip: IPS.enumeration,
      });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(404), "guessed tokens return 404, never 200");
    assert.equal(statuses[statuses.length - 1], 429, "the request past the budget is rate-limited");
  });
});

/* ========================= 5. connection code redemption ================= */

describe("connection code redemption guardrails", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  const redeem = (
    body: Record<string, unknown>,
    ip: string,
  ): ReturnType<typeof api> => api({ path: "/api/partner/connect", method: "POST", body, ip });

  it("redeems a fresh code into a live listing with a fresh session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const jar: Record<string, string> = {};
    const res = await api({
      path: "/api/partner/connect",
      method: "POST",
      ip: IPS.code,
      jar,
      body: {
        code: getFixture().codes.unused,
        name: "New Bistro",
        cuisines: ["Burgers", "Pizza"],
        locality: "Old City",
        externalId: "POS_NEW_001",
      },
    });
    assert.equal(res.status, 201);
    assert.equal(typeof res.json?.["ownerKey"], "string");
    assert.ok(jar["crave_restaurant_session"], "redeem mints a partner session");
    const who = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.code, jar });
    assert.equal(who.status, 200);
    assert.equal((who.json?.restaurant as Record<string, unknown> | undefined)?.name, "New Bistro");
  });

  it("the same code cannot be redeemed twice", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await redeem(
      { code: getFixture().codes.unused, name: "Sneaky Copy", cuisines: ["Pizza"], locality: "Old City", externalId: "POS_NEW_COPY" },
      IPS.code,
    );
    assert.equal(res.status, 400);
    assert.match(res.text, /used/i);
  });

  it("refuses a previously used code", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await redeem(
      { code: getFixture().codes.used, name: "Late Claim", cuisines: ["Pizza"], locality: "Old City", externalId: "POS_LATE" },
      IPS.code,
    );
    assert.equal(res.status, 400);
  });

  it("refuses a revoked code", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await redeem(
      { code: getFixture().codes.revoked, name: "Zombie Claim", cuisines: ["Pizza"], locality: "Old City", externalId: "POS_ZOMBIE" },
      IPS.code,
    );
    assert.equal(res.status, 400);
  });

  it("refuses an expired code", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await redeem(
      { code: getFixture().codes.expired, name: "Too Late", cuisines: ["Pizza"], locality: "Old City", externalId: "POS_LATE2" },
      IPS.code,
    );
    assert.equal(res.status, 400);
    assert.match(res.text, /expired/i);
  });

  it("refuses an unknown code", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await redeem(
      { code: "ZZZZZ", name: "Phantom", cuisines: ["Pizza"], locality: "Old City", externalId: "POS_PHANTOM" },
      IPS.code,
    );
    assert.equal(res.status, 400);
    assert.match(res.text, /not found/i);
  });

  it("rejects an off-vocabulary cuisine without spending the code", async (t) => {
    if (skipIfUnavailable(t)) return;
    const codeId = await seedConnectionCode({ code: "AXQBN", status: "unused" });
    const res = await redeem(
      { code: "AXQBN", name: "Klingon Grill", cuisines: ["Klingon"], locality: "Old City", externalId: "POS_KLINGON" },
      IPS.code,
    );
    assert.equal(res.status, 400);
    const row = await queryRow<{ status: string }>("select status from connection_codes where id = $1", [codeId]);
    assert.equal(row?.status, "unused", "a rejected redemption leaves the code spendable");
  });
});

/* ============================ 6. integration bearer auth ================= */

describe("integration bearer authentication and scoping", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  it("refuses an unauthenticated integration request", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/integration/orders", method: "GET", ip: IPS.integration });
    assert.equal(res.status, 401);
  });

  it("refuses a wrong passkey", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({
      path: "/api/integration/login",
      method: "POST",
      ip: IPS.integration,
      body: { code: getFixture().codes.login, passkey: "wrong-passkey" },
    });
    assert.equal(res.status, 401);
  });

  it("mints a bearer session for a valid passkey", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const res = await api({
      path: "/api/integration/login",
      method: "POST",
      ip: IPS.integration,
      body: { code: f.codes.login, passkey: f.alpha.ownerKey },
    });
    assert.equal(res.status, 200);
    assert.equal(typeof res.json?.["token"], "string");
  });

  it("a valid bearer sees only its own restaurant's orders", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const login = await api({
      path: "/api/integration/login",
      method: "POST",
      ip: IPS.integration,
      body: { code: f.codes.login, passkey: f.alpha.ownerKey },
    });
    const token = (login.json?.["token"] as string) ?? "";
    const res = await api({ path: "/api/integration/orders", method: "GET", ip: IPS.integration, headers: bearer(token) });
    assert.equal(res.status, 200);
    const codes = ((res.json?.orders as Record<string, unknown>[]) ?? []).map((o) => o["code"]);
    assert.deepEqual(codes.slice().sort(), [f.alphaOpen.code, f.alphaClosed.code].sort());
    assert.ok(!codes.includes(f.betaOpen.code), "beta's order must not leak to alpha's token");
  });

  it("refuses a garbage bearer token", async (t) => {
    if (skipIfUnavailable(t)) return;
    const res = await api({ path: "/api/integration/orders", method: "GET", ip: IPS.integration, headers: bearer("garbage") });
    assert.equal(res.status, 401);
  });

  it("refuses an expired integration session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const login = await api({
      path: "/api/integration/login",
      method: "POST",
      ip: IPS.integration,
      body: { code: f.codes.login, passkey: f.alpha.ownerKey },
    });
    const token = (login.json?.["token"] as string) ?? "";
    await expireIntegrationSession(token);
    const res = await api({ path: "/api/integration/orders", method: "GET", ip: IPS.integration, headers: bearer(token) });
    assert.equal(res.status, 401);
  });

  it("refuses a revoked integration session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const login = await api({
      path: "/api/integration/login",
      method: "POST",
      ip: IPS.integration,
      body: { code: f.codes.login, passkey: f.alpha.ownerKey },
    });
    const token = (login.json?.["token"] as string) ?? "";
    await revokeIntegrationSession(token);
    const res = await api({ path: "/api/integration/orders", method: "GET", ip: IPS.integration, headers: bearer(token) });
    assert.equal(res.status, 401);
  });

  it("an integration token cannot mint connection codes", async (t) => {
    if (skipIfUnavailable(t)) return;
    const f = getFixture();
    const login = await api({
      path: "/api/integration/login",
      method: "POST",
      ip: IPS.integration,
      body: { code: f.codes.login, passkey: f.alpha.ownerKey },
    });
    const token = (login.json?.["token"] as string) ?? "";
    const res = await api({
      path: "/api/partner/codes",
      method: "GET",
      ip: IPS.integration,
      headers: bearer(token),
    });
    assert.equal(res.status, 401);
  });
});

/* ======================= 7. restaurant deletion gates ==================== */

describe("restaurant deletion gates", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  async function seedTarget(tag: string): Promise<{
    name: string;
    jar: Record<string, string>;
  }> {
    const name = `Doomed ${tag}`;
    const r = await seedRestaurant({
      slug: `doomed-${tag.toLowerCase()}`,
      name,
      externalId: `POS_DEL_${tag.toUpperCase()}`,
      ownerKey: `del-owner-${tag}`,
    });
    const sess = await seedSession({
      restaurantId: r.id,
      token: `del-tok-${tag}`,
      csrf: `del-csrf-${tag}`,
    });
    await seedOrder({
      code: `CRV-DLX${tag.toUpperCase()}`,
      restaurant: { id: r.id, slug: r.slug, name: r.name },
      externalOrderId: `mkt_del_${tag}`,
    });
    return { name, jar: jarFrom(sess) };
  }

  async function mint(jar: Record<string, string>): Promise<string> {
    const res = await api({
      path: "/api/partner/restaurant/delete-intent",
      method: "POST",
      ip: IPS.delete,
      jar,
      headers: csrfHeaders(jar),
    });
    assert.equal(res.status, 200, "delete-intent should succeed for a live session");
    return (res.json?.["deleteToken"] as string) ?? "";
  }

  async function attemptDelete(
    jar: Record<string, string>,
    confirmName: string,
    deleteToken: string,
  ): Promise<{ status: number; text: string }> {
    const res = await api({
      path: "/api/partner/restaurant",
      method: "DELETE",
      ip: IPS.delete,
      jar,
      headers: csrfHeaders(jar),
      body: { confirmName, deleteToken },
    });
    return { status: res.status, text: res.text };
  }

  it("delete-intent requires a session and CSRF", async (t) => {
    if (skipIfUnavailable(t)) return;
    const noSession = await api({
      path: "/api/partner/restaurant/delete-intent",
      method: "POST",
      ip: IPS.delete,
    });
    assert.equal(noSession.status, 401);
  });

  it("the confirmation is single-use: a wrong name burns it", async (t) => {
    if (skipIfUnavailable(t)) return;
    const { name, jar } = await seedTarget("singleuse");
    const deleteToken = await mint(jar);
    const wrong = await attemptDelete(jar, "Wrong Name", deleteToken);
    assert.equal(wrong.status, 400, "wrong typed name is rejected");
    const retry = await attemptDelete(jar, name, deleteToken);
    assert.equal(retry.status, 403, "the spent confirmation cannot be reused with the right name");
    const row = await queryRow<{ name: string }>("select name from restaurants where external_id = $1", [
      "POS_DEL_SINGLEUSE",
    ]);
    assert.equal(row?.name, name, "the listing survives a burned confirmation");
  });

  it("a confirmation cannot be used through a different session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const x = await seedTarget("ownerx");
    const y = await seedTarget("ownery");
    const deleteToken = await mint(x.jar);
    const res = await attemptDelete(y.jar, x.name, deleteToken);
    assert.equal(res.status, 403, "the token is bound to the session that requested it");
    const row = await queryRow<{ name: string }>("select name from restaurants where external_id = $1", [
      "POS_DEL_OWNERX",
    ]);
    assert.equal(row?.name, x.name, "the other restaurant is untouched");
  });

  it("an expired confirmation is refused", async (t) => {
    if (skipIfUnavailable(t)) return;
    const name = "Doomed Expired";
    const r = await seedRestaurant({
      slug: "doomed-expired",
      name,
      externalId: "POS_DEL_EXPIRED",
      ownerKey: "del-owner-expired",
    });
    const token = "del-tok-expired";
    const csrf = "del-csrf-expired";
    await seedSession({
      restaurantId: r.id,
      token,
      csrf,
      deleteToken: "confirm-expired",
      deleteConfirmExpiresAtMs: Date.now() - 5_000,
    });
    const jar = jarFrom({ token, csrf });
    const res = await attemptDelete(jar, name, "confirm-expired");
    assert.equal(res.status, 403);
  });

  it("the full correct flow deletes the listing, its orders and its session", async (t) => {
    if (skipIfUnavailable(t)) return;
    const { name, jar } = await seedTarget("fullflow");
    const deleteToken = await mint(jar);
    const res = await attemptDelete(jar, name, deleteToken);
    assert.equal(res.status, 200);
    const who = await api({ path: "/api/partner/restaurant", method: "GET", ip: IPS.delete, jar });
    assert.equal(who.status, 401, "the session died with the listing (the cascade removed the session row)");
    const restaurants = await queryRows<Record<string, unknown>>(
      "select 1 from restaurants where external_id = $1",
      ["POS_DEL_FULLFLOW"],
    );
    const orders = await queryRows<Record<string, unknown>>(
      "select 1 from orders where external_order_id = $1",
      ["mkt_del_fullflow"],
    );
    const sessions = await queryRows<Record<string, unknown>>(
      "select 1 from restaurant_sessions where token_hash = $1",
      ["del-tok-fullflow"],
    );
    assert.equal(restaurants.length, 0, "the listing is gone");
    assert.equal(orders.length, 0, "the order history is gone");
    assert.equal(sessions.length, 0, "the session is gone");
  });

  it("rate-limits deletion attempts per session (3/hour)", async (t) => {
    if (skipIfUnavailable(t)) return;
    const name = "Doomed Throttle";
    const r = await seedRestaurant({
      slug: "doomed-throttle",
      name,
      externalId: "POS_DEL_THROTTLE",
      ownerKey: "del-owner-throttle",
    });
    const sess = await seedSession({ restaurantId: r.id, token: "del-tok-throttle", csrf: "del-csrf-throttle" });
    const jar = jarFrom(sess);
    const outcomes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const deleteToken = await mint(jar);
      const res = await attemptDelete(jar, "Wrong Name", deleteToken);
      outcomes.push(res.status);
    }
    assert.deepEqual(outcomes, [400, 400, 400, 429], "three wrong-name attempts, then the session is throttled");
    const row = await queryRow<{ name: string }>("select name from restaurants where external_id = $1", [
      "POS_DEL_THROTTLE",
    ]);
    assert.equal(row?.name, name, "the throttled restaurant is still there");
  });
});

/* ======================== 8. payment webhook verification ================ */

describe("payment webhook verification (Phase 6/9 contract)", () => {
  before(async () => {
    if (!harnessReady) return;
    await resetAndSeed();
  });

  async function seedPaidFixture(
    tag: string,
    orderId: string,
    paymentReference: string,
    amountCents = 18000,
  ): Promise<{ orderId: number; providerOrderId: string; paymentReference: string }> {
    const r = await seedRestaurant({
      slug: `pay-${tag}`,
      name: `Pay ${tag}`,
      externalId: `POS_PAY_${tag.toUpperCase()}`,
      ownerKey: `paykey-${tag}`,
    });
    const order = await seedOrder({
      code: `CRV-PAY${tag.toUpperCase()}`,
      restaurant: { id: r.id, slug: r.slug, name: r.name },
      externalOrderId: `mkt_pay_${tag}`,
      totalCents: amountCents,
      paymentStatus: "PAYMENT_PENDING",
    });
    await seedPayment({
      paymentReference,
      marketplaceOrderId: order.id,
      externalOrderId: `mkt_pay_${tag}`,
      restaurantId: r.id,
      providerOrderId: orderId,
      amountCents,
    });
    return { orderId: order.id, providerOrderId: orderId, paymentReference };
  }

  function captureFrame(
    eventId: string,
    entity: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      id: eventId,
      event: "payment.captured",
      payload: { payment: { entity } },
    });
  }

  function sendWebhook(
    raw: string,
    secret: string = WEBHOOK_SECRET,
  ): ReturnType<typeof api> {
    return api({
      path: "/api/integrations/payments/webhook",
      method: "POST",
      ip: IPS.payment,
      headers: { "x-razorpay-signature": hmacSha256Hex(secret, raw) },
      body: raw,
    });
  }

  it("a matching capture marks the payment paid and verified", async (t) => {
    if (skipIfUnavailable(t)) return;
    const fx = await seedPaidFixture("good", "ord_py_good", "PAY-SEC-GOOD");
    const raw = captureFrame("evt_py_good", {
      id: "pay_py_good",
      amount: 18000,
      currency: "INR",
      order_id: fx.providerOrderId,
      status: "captured",
      method: "upi",
    });
    const res = await sendWebhook(raw);
    assert.equal(res.status, 200);
    assert.equal(res.json?.["applied"], true);
    assert.equal(res.json?.["payment_status"], "PAID");
    const pay = await queryRow<Record<string, unknown>>(
      "select status, signature_verified from marketplace_payments where payment_reference = $1",
      [fx.paymentReference],
    );
    assert.equal(pay?.status, "PAID");
    assert.equal(pay?.signature_verified, true);
    const order = await queryRow<{ paymentStatus: string }>(
      "select payment_status as \"paymentStatus\" from orders where id = $1",
      [fx.orderId],
    );
    assert.equal(order?.paymentStatus, "PAID");
  });

  it("an amount mismatch fails the payment and never marks it paid", async (t) => {
    if (skipIfUnavailable(t)) return;
    const fx = await seedPaidFixture("badamt", "ord_py_badamt", "PAY-SEC-BADAMT");
    const raw = captureFrame("evt_py_badamt", {
      id: "pay_py_badamt",
      amount: 17999,
      currency: "INR",
      order_id: fx.providerOrderId,
      status: "captured",
      method: "upi",
    });
    const res = await sendWebhook(raw);
    assert.equal(res.status, 200);
    assert.equal(res.json?.["applied"], true);
    assert.equal(res.json?.["payment_status"], "FAILED");
    const pay = await queryRow<Record<string, unknown>>(
      "select status, failure_code from marketplace_payments where payment_reference = $1",
      [fx.paymentReference],
    );
    assert.equal(pay?.status, "FAILED");
    assert.equal(pay?.failure_code, "PAYMENT_AMOUNT_MISMATCH");
  });

  it("a currency mismatch fails the payment", async (t) => {
    if (skipIfUnavailable(t)) return;
    const fx = await seedPaidFixture("badcur", "ord_py_badcur", "PAY-SEC-BADCUR");
    const raw = captureFrame("evt_py_badcur", {
      id: "pay_py_badcur",
      amount: 18000,
      currency: "USD",
      order_id: fx.providerOrderId,
      status: "captured",
      method: "upi",
    });
    const res = await sendWebhook(raw);
    assert.equal(res.json?.["payment_status"], "FAILED");
    const pay = await queryRow<Record<string, unknown>>(
      "select status, failure_code from marketplace_payments where payment_reference = $1",
      [fx.paymentReference],
    );
    assert.equal(pay?.failure_code, "PAYMENT_CURRENCY_MISMATCH");
  });

  it("rejects a frame with a wrong signature", async (t) => {
    if (skipIfUnavailable(t)) return;
    const fx = await seedPaidFixture("badsig", "ord_py_badsig", "PAY-SEC-BADSIG");
    const raw = captureFrame("evt_py_badsig", {
      id: "pay_py_badsig",
      amount: 18000,
      currency: "INR",
      order_id: fx.providerOrderId,
      status: "captured",
      method: "upi",
    });
    const res = await sendWebhook(raw, "wrong-signing-secret");
    assert.equal(res.status, 400);
    const pay = await queryRow<{ status: string }>("select status from marketplace_payments where payment_reference = $1", [
      fx.paymentReference,
    ]);
    assert.equal(pay?.status, "PAYMENT_PENDING", "a rejected frame must not move money state");
  });

  it("rejects a frame with no signature", async (t) => {
    if (skipIfUnavailable(t)) return;
    const fx = await seedPaidFixture("nosig", "ord_py_nosig", "PAY-SEC-NOSIG");
    const raw = captureFrame("evt_py_nosig", {
      id: "pay_py_nosig",
      amount: 18000,
      currency: "INR",
      order_id: fx.providerOrderId,
      status: "captured",
      method: "upi",
    });
    const res = await api({
      path: "/api/integrations/payments/webhook",
      method: "POST",
      ip: IPS.payment,
      body: raw,
    });
    assert.equal(res.status, 400);
    const pay = await queryRow<{ status: string }>("select status from marketplace_payments where payment_reference = $1", [
      fx.paymentReference,
    ]);
    assert.equal(pay?.status, "PAYMENT_PENDING");
  });

  it("deduplicates a replayed event (event_id idempotency)", async (t) => {
    if (skipIfUnavailable(t)) return;
    const fx = await seedPaidFixture("dup", "ord_py_dup", "PAY-SEC-DUP");
    const raw = captureFrame("evt_py_dup", {
      id: "pay_py_dup",
      amount: 18000,
      currency: "INR",
      order_id: fx.providerOrderId,
      status: "captured",
      method: "upi",
    });
    const first = await sendWebhook(raw);
    const second = await sendWebhook(raw);
    assert.equal(first.json?.["deduplicated"], false);
    assert.equal(second.json?.["deduplicated"], true);
    const events = await queryRows<Record<string, unknown>>(
      "select event_id from marketplace_payment_events where event_id = $1",
      ["rzp:evt_py_dup:payment.captured"],
    );
    assert.equal(events.length, 1, "one event row per event id, even after a replay");
  });

  it("does not deliver-to-POS when the frame does not verify the money", async (t) => {
    if (skipIfUnavailable(t)) return;
    const fx = await seedPaidFixture("fraud", "ord_py_fraud", "PAY-SEC-FRAUD");
    const raw = captureFrame("evt_py_fraud", {
      id: "pay_py_fraud",
      amount: 18000,
      currency: "INR",
      order_id: fx.providerOrderId,
      status: "captured",
      method: "upi",
    });
    await sendWebhook(raw, "forged-signature");
    // Wrong signature -> 400, and nothing may have been queued for a POS.
    assert.equal(
      (await queryRows<Record<string, unknown>>(
        "select 1 from marketplace_payments where payment_reference = $1 and status = 'PAID'",
        [fx.paymentReference],
      )).length,
      0,
      "forged capture must never advance the payment to PAID",
    );
  });
});