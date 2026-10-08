/**
 * Tests for the partner session policy.
 *
 * Run with: npm test
 *
 * The client-visible part of this — cookies, the exchange, who is signed in —
 * lives in `security/restaurant-session.ts`, which is `server-only` and cannot
 * be imported here. That is not a gap: everything in this file is the *decision*
 * side, the pure policy the route layer just applies:
 *
 *   - Lifetime. A session lives 30 days and a delete confirmation 10 minutes.
 *     The numbers are the whole trade — long enough for a real operator, short
 *     enough that a stolen cookie is not a permanent key — so they are pinned
 *     exactly.
 *   - What makes a session unusable. Revoked or expired, either one is refused;
 *     and a revocation is checked before an expiry so a clock change cannot
 *     revive a session somebody actually revoked.
 *   - The cookies themselves. These attributes are the reason a cookie is not
 *     equivalent to the `x-owner-key` header it replaces, so the `Set-Cookie`
 *     values are asserted verbatim-ish: `HttpOnly` on exactly one of the pair,
 *     `SameSite=Lax` and `Path=/` on both, `Max-Age` matching the TTL, `Secure`
 *     following the request's scheme rather than an env var.
 *   - CSRF. The submitted token is compared hash-then-constant-time, and the
 *     pair is deliberately asymmetric: the session cookie is unreadable by
 *     script, the CSRF cookie is not.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  RESTAURANT_SESSION_COOKIE,
  RESTAURANT_CSRF_COOKIE,
  RESTAURANT_CSRF_HEADER,
  RESTAURANT_SESSION_TTL_MS,
  DELETE_CONFIRM_TTL_MS,
  makeSessionToken,
  makeCsrfToken,
  sessionIsLive,
  csrfMatches,
  deleteConfirmationIsLive,
  buildSessionCookie,
  buildCsrfCookie,
  buildClearedSessionCookies,
  type SessionRowLike,
} from "../src/lib/restaurant-session-core";

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function liveRow(overrides: Partial<SessionRowLike> = {}): SessionRowLike {
  return {
    expiresAt: new Date(Date.now() + RESTAURANT_SESSION_TTL_MS),
    revokedAt: null,
    ...overrides,
  };
}

/* -------------------------------- lifetimes ------------------------------- */

test("the session lives 30 days and the delete confirmation 10 minutes", () => {
  // Pinned exactly: these constants ARE the policy. If a refactor rounds one off
  // by a millisecond, the trade being shipped changed and this should say so.
  assert.equal(RESTAURANT_SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(DELETE_CONFIRM_TTL_MS, 10 * 60 * 1000);
  assert.ok(DELETE_CONFIRM_TTL_MS < RESTAURANT_SESSION_TTL_MS, "a confirmation must outlive nothing");
});

/* --------------------------------- tokens --------------------------------- */

test("a session token is 32 random bytes, base64url, with no padding", () => {
  const token = makeSessionToken();
  // 32 bytes, base64url: 43 significant characters, no trailing "=".
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(token, /=/, "base64url drops padding");
  const another = makeSessionToken();
  assert.notEqual(another, token);
  assert.equal(Buffer.from(token, "base64url").length, 32);
});

test("the CSRF token is independent of the session token", () => {
  // Independent rather than derived, so leaking one does not leak the other and
  // rotating the session does not have to rotate the CSRF token to invalidate it.
  const csrf = makeCsrfToken();
  assert.equal(csrf.length, 43);
  assert.match(csrf, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(csrf, makeSessionToken());
  assert.notEqual(csrf, makeCsrfToken(), "each mint is fresh");
});

/* ------------------------------- liveness ---------------------------------- */

test("null or missing session rows are not live", () => {
  assert.equal(sessionIsLive(null), false);
  assert.equal(sessionIsLive(undefined), false);
});

test("a live session row is live, an expired one is not", () => {
  assert.equal(sessionIsLive(liveRow()), true);
  const expired = new Date(Date.now() - 1);
  assert.equal(sessionIsLive(liveRow({ expiresAt: expired })), false);
  // The boundary is exclusive: expiring exactly now is already too late.
  assert.equal(sessionIsLive(liveRow({ expiresAt: new Date(Date.now()) })), false);
});

test("a revoked session is refused even if it would not have expired", () => {
  // The documented order: `revokedAt` is checked before `expiresAt`, so a clock
  // change cannot revive a session somebody actually revoked.
  const revoked = liveRow({ revokedAt: new Date() });
  assert.equal(sessionIsLive(revoked), false);
  // Even revoked well within the window and against a far-future expiry.
  const revokedYoung = liveRow({
    revokedAt: new Date(Date.now() - 60 * 1000),
    expiresAt: new Date(Date.now() + 10 * RESTAURANT_SESSION_TTL_MS),
  });
  assert.equal(sessionIsLive(revokedYoung), false);
});

/* ----------------------------- delete confirms ----------------------------- */

test("only a present, unexpired confirmation is live", () => {
  assert.equal(deleteConfirmationIsLive(liveRow()), false, "no token stored yet");
  assert.equal(
    deleteConfirmationIsLive(liveRow({ deleteConfirmHash: "x", deleteConfirmExpiresAt: null })),
    false,
  );
  assert.equal(
    deleteConfirmationIsLive(
      liveRow({ deleteConfirmHash: "x", deleteConfirmExpiresAt: new Date(Date.now() - 1) }),
    ),
    false,
    "expired is gone even with a token present",
  );
  assert.equal(
    deleteConfirmationIsLive(
      liveRow({ deleteConfirmHash: "x", deleteConfirmExpiresAt: new Date(Date.now() + 60 * 1000) }),
    ),
    true,
  );
});

test("confirmation liveness has its own short clock, separate from the session", () => {
  // Ten minutes vs thirty days. Held separately so the two cannot be conflated:
  // a session can be perfect while its confirmation has already lapsed mid-dialog.
  const youngRow = liveRow({
    deleteConfirmHash: "x",
    deleteConfirmExpiresAt: new Date(Date.now() + DELETE_CONFIRM_TTL_MS),
  });
  assert.equal(deleteConfirmationIsLive(youngRow), true);
  assert.equal(sessionIsLive(youngRow), true);
  // At the other extreme a revoked session still carries a live confirmation —
  // the delete handler reads both, so this is a signal the route must not rely
  // on one check to stand in for the other.
  const revokedRow = liveRow({
    revokedAt: new Date(),
    deleteConfirmHash: "x",
    deleteConfirmExpiresAt: new Date(Date.now() + 60 * 1000),
  });
  assert.equal(deleteConfirmationIsLive(revokedRow), true);
  assert.equal(sessionIsLive(revokedRow), false);
});

/* ---------------------------------- CSRF ----------------------------------- */

test("a matching CSRF token passes hash-then-compare", () => {
  const submitted = makeCsrfToken();
  const storedHash = sha256hex(submitted);
  assert.equal(csrfMatches(storedHash, submitted), true);
});

test("CSRF comparison ignores harmless surrounding whitespace", () => {
  // The server stores the hash, so the submitted value is trimmed before hashing
  // to keep a client that padded the header from failing a live token.
  const submitted = makeCsrfToken();
  assert.equal(csrfMatches(sha256hex(submitted), ` ${submitted}\n`), true);
});

test("a mismatched, empty or non-string CSRF token is refused", () => {
  const storedHash = sha256hex("whatever");
  assert.equal(csrfMatches(storedHash, "nope"), false);
  assert.equal(csrfMatches(storedHash, ""), false);
  assert.equal(csrfMatches(storedHash, undefined), false);
  assert.equal(csrfMatches(storedHash, 42), false);
});

test("a stored value of the wrong length can never match", () => {
  // A short or malformed stored hash must compare false without throwing: it is
  // the length guard that makes the constant-time compare callable at all.
  assert.equal(csrfMatches("abc", "abc"), false);
  assert.equal(csrfMatches("", makeCsrfToken()), false);
});

/* ---------------------------------- cookies -------------------------------- */

test("the session cookie is HttpOnly with a 30-day Max-Age", () => {
  const cookie = buildSessionCookie("s3cret", {
    maxAgeSeconds: RESTAURANT_SESSION_TTL_MS / 1000,
    secure: false,
  });
  assert.ok(cookie.startsWith(`${RESTAURANT_SESSION_COOKIE}=s3cret`), "names the token value");
  assert.match(cookie, /; Path=\//, "visible across the whole partner console");
  assert.match(cookie, /; HttpOnly/, "script must never read the session");
  assert.match(cookie, /; SameSite=Lax/, "sent on same-origin fetches and top-level navigation, not cross-site subrequests");
  assert.match(cookie, /; Max-Age=2592000/, "Max-Age is the TTL in seconds");
  assert.doesNotMatch(cookie, /; Secure/, "no Secure attribute on plain HTTP");
});

test("Secure follows the request scheme, not an env var", () => {
  const overTls = buildSessionCookie("t", { maxAgeSeconds: 1, secure: true });
  assert.match(overTls, /; Secure/);
  const overPlain = buildSessionCookie("t", { maxAgeSeconds: 1, secure: false });
  assert.doesNotMatch(overPlain, /; Secure/);
});

test("the CSRF cookie is identical except it is readable by script", () => {
  const opts = { maxAgeSeconds: RESTAURANT_SESSION_TTL_MS / 1000, secure: true };
  const session = buildSessionCookie("tok", opts);
  const csrf = buildCsrfCookie("csrf-tok", opts);
  assert.ok(csrf.startsWith(`${RESTAURANT_CSRF_COOKIE}=csrf-tok`));
  assert.doesNotMatch(csrf, /; HttpOnly/, "the CSRF token must be readable by script");
  assert.match(csrf, /; SameSite=Lax/, "stays paired with the session cookie");
  assert.match(csrf, /; Path=\//, "stays paired with the session cookie");
  assert.match(csrf, /; Max-Age=2592000/, "same lifetime so the pair cannot drift out of step");
  // Strip name, value and the HttpOnly flag from each and the attributes match
  // exactly — the asymmetry is that one flag, intentionally.
  const attrsOf = (cookie: string) => cookie.replace(/^[^=]+=[^;]*; /, "").replace(/; HttpOnly/, "");
  assert.equal(attrsOf(session), attrsOf(csrf));
});

test("sign-out clears both cookies as an exact pair, HttpOnly preserved", () => {
  const cleared = buildClearedSessionCookies({ secure: true });
  assert.equal(cleared.length, 2);
  const [sessionPart, csrfPart] = cleared;
  assert.ok(sessionPart.startsWith(`${RESTAURANT_SESSION_COOKIE}=`), "value emptied");
  assert.ok(csrfPart.startsWith(`${RESTAURANT_CSRF_COOKIE}=`), "value emptied");
  // Max-Age=0 kills the cookie; the attributes that created it are repeated so
  // the deletion actually matches what was set.
  assert.match(sessionPart, /; Max-Age=0/);
  assert.match(csrfPart, /; Max-Age=0/);
  assert.match(sessionPart, /; HttpOnly/, "retains the flag so the browser accepts the replacement");
  assert.doesNotMatch(csrfPart, /; HttpOnly/);
});

test("the header name is the documented pair to the CSRF cookie", () => {
  assert.equal(RESTAURANT_CSRF_HEADER, "x-csrf-token");
  assert.notEqual(RESTAURANT_CSRF_COOKIE, RESTAURANT_SESSION_COOKIE, "session and CSRF tokens are not one token");
});