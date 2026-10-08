/**
 * The partner session's policy, as pure functions.
 *
 * Split from `security/restaurant-session.ts` for the same reason
 * `abuse-core.ts` and `cron-auth-core.ts` exist: the `server-only` marker
 * throws by design outside the Next bundler, so the decisions worth asserting —
 * how long a session lives, what makes one unusable, what a cookie may carry,
 * when a destructive confirmation is spent — cannot be tested in the same file
 * as the marker.
 *
 * What changed and why it is here
 * -------------------------------
 *
 * The owner key used to be the session: the same 18-byte secret proved
 * ownership, authenticated every `/api/partner/*` call, and was replayed by the
 * browser on each one. As a session that is three failures at once — it never
 * expires, it cannot be revoked without destroying the restaurant's only
 * credential, and the server keeps no record of who is signed in, so "sign out
 * everywhere" is not expressible.
 *
 * The owner key is not thrown away. It becomes the *recovery* credential: proved
 * once, exchanged for a bounded, revocable session. That is the trade this file
 * encodes.
 *
 * The CSRF token here is not decoration. The old `x-owner-key` header gave the
 * partner API implicit CSRF protection: a custom header triggers a CORS preflight
 * that a cross-origin form cannot pass, so a hostile page could not make the
 * browser replay the credential. Moving to a cookie removes exactly that — the
 * browser now attaches the credential on its own — so the defence has to be
 * rebuilt deliberately rather than inherited.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Cookie carrying the session token. HttpOnly, so script cannot read it. */
export const RESTAURANT_SESSION_COOKIE = "crave_restaurant_session";

/**
 * Cookie carrying the paired CSRF token. Deliberately NOT HttpOnly.
 *
 * This is the one place a CSRF token has to be readable by script, and the reason
 * is that the server stores only its hash — a hash cannot be given back, so a
 * token that existed solely in a response body would have to be re-minted on
 * every reload, and rotating it on each load invalidates the token another open
 * tab is still holding.
 *
 * Reading it costs nothing, because reading it is not what makes an attack work.
 * A cross-origin page cannot read this cookie at all, and cannot set the
 * `x-csrf-token` header without passing a preflight. What the readability does buy
 * is that a token captured here cannot be lifted out of the browser by script and
 * replayed later from somewhere else — which is exactly what the HttpOnly session
 * cookie prevents for the credential itself. Two cookies, two jobs: one the page
 * must be able to read to prove intent, one it must never be able to read because
 * reading it *is* the attack.
 */
export const RESTAURANT_CSRF_COOKIE = "crave_restaurant_csrf";

/** Header carrying the paired CSRF token on state-changing partner requests. */
export const RESTAURANT_CSRF_HEADER = "x-csrf-token";

/**
 * How long a session lives.
 *
 * 30 days. Long enough that a restaurant never sees an expiry in normal use — the
 * console is used by one person on one device, and a session that expires mid-task
 * looks like data loss — and short enough that a stolen cookie is not a permanent
 * key to the listing. The owner key remains valid after this, so expiry costs a
 * re-authentication, never a lockout.
 */
export const RESTAURANT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a delete confirmation is valid.
 *
 * 10 minutes, and it is deliberately short. The confirmation exists to prove the
 * operator meant it, so it only needs to survive reading a dialog and typing a
 * name. Anything longer is a window in which a token captured off the wire (or
 * read by a script that got the drop on the page) stays good.
 */
export const DELETE_CONFIRM_TTL_MS = 10 * 60 * 1000;

/**
 * Session token: 32 random bytes, base64url.
 *
 * Longer than the owner key's 18 on purpose. The owner key is typed by a human
 * into a form and stored by hand, so its entropy is bounded by transcription; this
 * one is never transcribed, so it can afford to be larger and needs no such
 * allowance.
 */
export function makeSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * CSRF token: 32 random bytes, independent of the session token.
 *
 * Independent rather than derived, so that leaking one does not leak the other,
 * and so rotating the session does not have to rotate the CSRF token for it to
 * stop being replayable.
 */
export function makeCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The subset of a stored session row these decisions read. */
export interface SessionRowLike {
  expiresAt: Date;
  revokedAt: Date | null;
  deleteConfirmHash?: string | null;
  deleteConfirmExpiresAt?: Date | null;
}

/**
 * Whether a session row may still authenticate a request.
 *
 * Order matters for the audit trail but not for the outcome: a revoked session
 * and an expired one are both refused, and checking `revokedAt` first means a
 * revoked session cannot be revived by a clock change that would otherwise have
 * kept it inside `expiresAt`.
 *
 * A row with no token at all is not a session, and there is nothing to compare —
 * the caller treats "not found" and "unusable" identically, so an attacker cannot
 * tell a guessed token from a revoked one.
 */
export function sessionIsLive(row: SessionRowLike | null | undefined, now: number = Date.now()): boolean {
  if (!row) return false;
  if (row.revokedAt) return false;
  return row.expiresAt.getTime() > now;
}

/**
 * Whether a submitted CSRF token matches the one bound to this session.
 *
 * Hash-then-compare, so the stored value is never the submitted one and the
 * comparison is constant-time. Reusing `ownerKeyMatches` rather than writing a
 * third variant of "compare a secret to a hash" in this codebase.
 */
export function csrfMatches(storedHash: string, submitted: unknown): boolean {
  const presented = String(submitted ?? "").trim();
  if (!presented) return false;
  const expected = Buffer.from(storedHash);
  const actual = Buffer.from(sha256hex(presented));
  return expected.length === actual.length && constantTimeEquals(expected, actual);
}

/**
 * Whether a delete confirmation is present and still fresh.
 *
 * Separate from `sessionIsLive` because the two have different clocks: the
 * session is good for weeks, the confirmation for minutes. Checking them
 * together would mean a request could pass "session live" and be refused deep in
 * a delete handler, after the operator had already typed their restaurant name.
 */
export function deleteConfirmationIsLive(row: SessionRowLike, now: number = Date.now()): boolean {
  if (!row.deleteConfirmHash) return false;
  if (!row.deleteConfirmExpiresAt) return false;
  return row.deleteConfirmExpiresAt.getTime() > now;
}

/** Cookie attributes for the session cookie. */
export interface SessionCookieOptions {
  maxAgeSeconds: number;
  /** `true` when the request that will carry this cookie was HTTPS. */
  secure: boolean;
}

/**
 * Serialise the session cookie as a `Set-Cookie` value.
 *
 * Built here rather than passed as an options object to `cookies().set` so the
 * attributes that matter are assertable in tests: the three below are the entire
 * reason the session cookie is not equivalent to the `x-owner-key` header it
 * replaces.
 *
 *   - `HttpOnly`  keeps the token out of `document.cookie`, so an XSS cannot
 *                 read the session the way it could read the owner key that
 *                 used to sit in web storage.
 *   - `SameSite=Lax`  the browser sends this on top-level navigation and on
 *                 same-origin fetches, which is exactly what the console does.
 *                 Cross-site subrequests and cross-site POSTs do not carry it,
 *                 so it stands on its own against form-based CSRF — and survives
 *                 a partner clicking a link to their own console from an email.
 *                 `Strict` would also be defensible; `Lax` is chosen because
 *                 `Strict` drops the cookie on the exact link a partner is most
 *                 likely to click first, and the CSRF token is the control that
 *                 actually has to be unforgeable.
 *   - `Secure`    set whenever the request itself arrived over TLS, so the
 *                 attribute follows the deployment instead of an env var that is
 *                 wrong in one of the two environments.
 *
 * `Path=/` because the console is three routes (`/partner`,
 * `/partner/menu`, `/partner/integrations`) and the partner expects to stay
 * signed in across all of them.
 */
export function buildSessionCookie(token: string, opts: SessionCookieOptions): string {
  return [
    `${RESTAURANT_SESSION_COOKIE}=${token}`,
    ...cookieAttributes({ ...opts, httpOnly: true }),
  ].join("; ");
}

/**
 * Serialise the CSRF cookie. Same lifetime and `SameSite` as the session cookie
 * so the pair cannot drift out of step, and intentionally NOT `HttpOnly` — see
 * {@link RESTAURANT_CSRF_COOKIE}. That asymmetry is the whole design: identical
 * in every attribute except the one that decides whether script can lift it.
 */
export function buildCsrfCookie(token: string, opts: SessionCookieOptions): string {
  return [
    `${RESTAURANT_CSRF_COOKIE}=${token}`,
    ...cookieAttributes({ ...opts, httpOnly: false }),
  ].join("; ");
}

/**
 * The `Set-Cookie` values that remove the session, as a pair.
 *
 * `Max-Age=0` rather than an `Expires` in the past, and the same `Path` and
 * `Secure` as the cookies they replace — a deletion that does not match the
 * original's `Path` silently fails, which looks to the user like sign-out did
 * nothing while the cookie is still being sent on every request. Both cookies are
 * returned together because leaving the CSRF cookie behind would strand it: a
 * stale readable token outliving its session is confusing at best, and at worst
 * looks like a valid one to the next partner debugging their console.
 */
export function buildClearedSessionCookies(opts: { secure: boolean }): string[] {
  const base = { secure: opts.secure, maxAgeSeconds: 0 };
  return [
    [`${RESTAURANT_SESSION_COOKIE}=`, ...cookieAttributes({ ...base, httpOnly: true })].join("; "),
    [`${RESTAURANT_CSRF_COOKIE}=`, ...cookieAttributes({ ...base, httpOnly: false })].join("; "),
  ];
}

/**
 * Attributes shared by both cookies.
 *
 * One function so the session and CSRF cookies cannot end up with different
 * `SameSite` or `Path` values, which would be a subtle and hard-to-spot way for
 * the pair to stop matching on deletion — and `httpOnly` is a parameter rather
 * than a constant because it is the *only* attribute that differs between them,
 * which is exactly the kind of thing that should be visible at the call site
 * rather than buried in a shared helper.
 */
function cookieAttributes(opts: SessionCookieOptions & { httpOnly: boolean }): string[] {
  const parts = ["Path=/"];
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push("SameSite=Lax", `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
  if (opts.secure) parts.push("Secure");
  return parts;
}

function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  // Node's timingSafeEqual throws on a length mismatch, so the guard is load
  // bearing rather than defensive.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
