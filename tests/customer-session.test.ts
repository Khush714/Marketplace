/**
 * Tests for the anonymous customer session's policy.
 *
 * Run with: npm test
 *
 * The server half — resolving the cookie, touching rows, appending
 * `Set-Cookie` — lives in `@/lib/customer-session.ts`, which is `server-only`
 * and cannot be imported here. That is not a gap: everything below is the
 * *decision* side, the pure policy the route layer just applies:
 *
 *   - Lifetime. 90 days, renewed only by an attach once inside half of that.
 *     The numbers are the whole trade — long enough that history persists for
 *     a real customer, short enough that a cookie lifted off a shared machine
 *     goes stale — so they are pinned exactly.
 *   - What makes a session unusable. Revoked or expired, either one is
 *     refused; revocation checked first so a clock change cannot revive a
 *     session somebody actually revoked (the stolen-cookie path).
 *   - The cookie itself. This attribute set is the *point* of the feature —
 *     `HttpOnly` is what makes the credential unreadable to the script that
 *     could read the order tokens out of web storage — so the `Set-Cookie`
 *     value is asserted piece by piece.
 *   - Order-code binding. Codes are normalised on both write and read, so a
 *     case mismatch can never deny the owner their own order, and the bound
 *   list stays deduplicated, recency-first and capped.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_MAX_CODES,
  CUSTOMER_SESSION_RENEW_BELOW_MS,
  CUSTOMER_SESSION_TTL_MS,
  buildClearedCustomerSessionCookie,
  buildCustomerSessionCookie,
  customerSessionIsLive,
  makeCustomerSessionToken,
  normalizeOrderCode,
  normalizeOrderCodes,
  type CustomerSessionRowLike,
} from "../src/lib/customer-session-core";

function liveRow(overrides: Partial<CustomerSessionRowLike> = {}): CustomerSessionRowLike {
  return {
    orderCodes: [],
    expiresAt: new Date(Date.now() + CUSTOMER_SESSION_TTL_MS),
    revokedAt: null,
    ...overrides,
  };
}

/* -------------------------------- lifetimes ------------------------------- */

test("a customer session lives 90 days and renews inside half of that", () => {
  // Pinned exactly: these constants ARE the policy. If a refactor rounds one
  // off, the trade being shipped changed and this should say so.
  assert.equal(CUSTOMER_SESSION_TTL_MS, 90 * 24 * 60 * 60 * 1000);
  assert.equal(CUSTOMER_SESSION_RENEW_BELOW_MS, CUSTOMER_SESSION_TTL_MS / 2);
  // Longer than the partner console's 30 days on purpose: this session holds
  // no PII and no mutation powers — order codes only — which is what buys the
  // extra lifetime over a working operator credential.
  assert.ok(CUSTOMER_SESSION_TTL_MS > 30 * 24 * 60 * 60 * 1000);
});

test("the session and CSRF cookie names do not collide with the partner session", () => {
  assert.equal(CUSTOMER_SESSION_COOKIE, "crave_customer_session");
  assert.notEqual(CUSTOMER_SESSION_COOKIE, "restaurant_session");
  assert.notEqual(CUSTOMER_SESSION_COOKIE, "restaurant_csrf");
});

/* --------------------------------- tokens --------------------------------- */

test("a session token is 32 random bytes, base64url, with no padding", () => {
  const token = makeCustomerSessionToken();
  // 32 bytes, base64url: 43 significant characters, no trailing "=".
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(token, /=/, "base64url drops padding");
  assert.notEqual(makeCustomerSessionToken(), token, "each mint is fresh");
  assert.equal(Buffer.from(token, "base64url").length, 32);
});

/* ------------------------------- liveness ---------------------------------- */

test("null or missing session rows are not live", () => {
  assert.equal(customerSessionIsLive(null), false);
  assert.equal(customerSessionIsLive(undefined), false);
});

test("a live session row is live, an expired one is not", () => {
  assert.equal(customerSessionIsLive(liveRow()), true);
  const expired = new Date(Date.now() - 1);
  assert.equal(customerSessionIsLive(liveRow({ expiresAt: expired })), false);
  // The boundary is exclusive: expiring exactly now is already too late.
  assert.equal(customerSessionIsLive(liveRow({ expiresAt: new Date(Date.now()) })), false);
});

test("a revoked session is refused even if it would not have expired", () => {
  // The documented order: `revokedAt` before `expiresAt`, so a clock change
  // cannot revive a session somebody actually revoked — revocation is the
  // check a stolen-cookie report actually exercises.
  assert.equal(customerSessionIsLive(liveRow({ revokedAt: new Date() })), false);
  const revokedYoung = liveRow({
    revokedAt: new Date(Date.now() - 60 * 1000),
    expiresAt: new Date(Date.now() + 10 * CUSTOMER_SESSION_TTL_MS),
  });
  assert.equal(customerSessionIsLive(revokedYoung), false);
});

/* ------------------------------ code binding ------------------------------- */

test("order codes are trimmed and uppercased on write and read", () => {
  // Codes are minted uppercase, but URLs and legacy storage have carried
  // mixed case — normalising on both sides is what keeps `includes()` from a
  // case mismatch denying the owner their own order.
  assert.equal(normalizeOrderCode(" crv-abc12 "), "CRV-ABC12");
  assert.equal(normalizeOrderCode("crv-abc12"), "CRV-ABC12");
  assert.equal(normalizeOrderCode(undefined), "");
  assert.equal(normalizeOrderCode(null), "");
  assert.equal(normalizeOrderCode("   "), "");
});

test("bound lists are deduplicated, recency-first and capped", () => {
  const merged = normalizeOrderCodes(["CRV-NEW", "crv-new", "CRV-OLD", "crv-old"]);
  assert.deepEqual(merged, ["CRV-NEW", "CRV-OLD"], "the first (newest) mention wins");

  const many = Array.from({ length: CUSTOMER_SESSION_MAX_CODES + 40 }, (_, i) => `CRV-${i}`);
  const capped = normalizeOrderCodes(many);
  assert.equal(capped.length, CUSTOMER_SESSION_MAX_CODES, "the tail is dropped, never the head");
  assert.equal(capped[0], "CRV-0", "newest first");
  assert.equal(capped.at(-1), "CRV-59");
});

test("empty and non-string entries never occupy a slot", () => {
  // A checkout that stored a blank code — or a corrupted legacy entry — must
  // not push a real order out of the capped list.
  const cleaned = normalizeOrderCodes(["", "   ", null, undefined, "CRV-REAL"]);
  assert.deepEqual(cleaned, ["CRV-REAL"]);
  assert.equal(CUSTOMER_SESSION_MAX_CODES >= 60, true, "at least two screens of history");
});

/* ---------------------------------- cookie --------------------------------- */

test("the session cookie is HttpOnly with a 90-day Max-Age", () => {
  const cookie = buildCustomerSessionTokenCookie(90 * 24 * 60 * 60);
  assert.ok(cookie.startsWith(`${CUSTOMER_SESSION_COOKIE}=`), "names the token value");
  assert.match(cookie, /; Path=\//, "order routes live under /api/orders and /order alike");
  assert.match(cookie, /; HttpOnly/, "script must never read the credential — that is the point");
  assert.match(
    cookie,
    /; SameSite=Lax/,
    "sent on same-origin fetches and top-level navigation, withheld cross-site",
  );
  assert.match(cookie, new RegExp(`; Max-Age=${90 * 24 * 60 * 60}`), "Max-Age is the TTL in seconds");
  assert.doesNotMatch(cookie, /; Secure/, "no Secure attribute on plain HTTP");
});

test("Secure follows the request scheme, not an env var", () => {
  const overTls = buildCustomerSessionCookie("t", { maxAgeSeconds: 1, secure: true });
  assert.match(overTls, /; Secure/);
  const overPlain = buildCustomerSessionCookie("t", { maxAgeSeconds: 1, secure: false });
  assert.doesNotMatch(overPlain, /; Secure/);
});

test("there is exactly one cookie — no CSRF pair to read back", () => {
  // The partner console ships a readable CSRF cookie beside its HttpOnly
  // session; this session has none. Everything that authorizes a mutation
  // here (guardWrite's origin check, SameSite=Lax) runs without one, so the
  // credential surface is a single unreadable cookie.
  const cookie = buildCustomerSessionCookie("tok", { maxAgeSeconds: 60, secure: true });
  assert.equal(cookie.includes("csrf"), false);
  assert.equal(cookie.split("crave_").length - 1, 1, "one cookie name, one credential");
});

test("clearing the cookie repeats the attributes that created it", () => {
  // A deletion whose Path/Secure/HttpOnly do not match the original is
  // silently ignored — which looks to the user like "clear my history link"
  // did nothing while the cookie keeps riding every request.
  const cleared = buildClearedCustomerSessionCookie({ secure: true });
  assert.ok(cleared.startsWith(`${CUSTOMER_SESSION_COOKIE}=`), "value emptied");
  assert.match(cleared, /; Max-Age=0/);
  assert.match(cleared, /; HttpOnly/, "retains the flag so the browser accepts the replacement");
  assert.match(cleared, /; Path=\//);
  assert.match(cleared, /; SameSite=Lax/);
  assert.match(cleared, /; Secure/);

  const plain = buildClearedCustomerSessionCookie({ secure: false });
  assert.doesNotMatch(plain, /; Secure/, "deletion mirrors an insecure set exactly");
});

/* -------------------------------------------------------------------------- */

/** The cookie with a full-TTL Max-Age, for the assertions that pin it. */
function buildCustomerSessionTokenCookie(ttlSeconds: number): string {
  return buildCustomerSessionCookie("tok", { maxAgeSeconds: ttlSeconds, secure: false });
}
