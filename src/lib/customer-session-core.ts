/**
 * The anonymous customer session's policy, as pure functions.
 *
 * Split from `security/customer-session.ts` for the same reason
 * `restaurant-session-core.ts`, `abuse-core.ts` and `cron-auth-core.ts` exist:
 * the `server-only` marker throws by design outside the Next bundler, so the
 * decisions worth asserting — how long a session lives, what makes one
 * unusable, what its cookie may carry, how an order code is matched against
 * the bound list — cannot be tested in the same file as the marker.
 *
 * What this replaces, and why
 * ---------------------------
 * The order credential used to be stored in the browser: `crave.profile.v1`
 * held every placed order as `{ code, token, trackingToken }` in the same JSON
 * object as the customer's name, phone and addresses. Splitting that blob into
 * separate localStorage keys would move the pieces apart but change nothing
 * about the threat that matters — script running on the page can read all of
 * them. So the credential moves server-side: the row names which order codes
 * this device may touch, the browser carries only an HttpOnly cookie naming
 * the row, and script can *spend* the session (fetches attach the cookie)
 * without ever being able to read it or replay it from somewhere else.
 *
 * The same properties the partner console's sessions were rebuilt for, in
 * miniature: a bounded lifetime (`expires_at`), a kill switch (`revoked_at`),
 * and no usable secret at rest (`token_hash`).
 *
 * No CSRF token on top of the cookie, deliberately: unlike the partner
 * console's mutation surface, everything here is behind the app's own
 * `guardWrite` origin check plus `SameSite=Lax`, which the partner session
 * also has — the double-submit token defends routes that would otherwise rely
 * on the cookie alone. `customer_sessions` holds no `csrf_hash` because no
 * route accepts a cookie without `guardWrite` first; if that ever changes, the
 * token has to be rebuilt here, not assumed away.
 */

import { randomBytes } from "node:crypto";
import { cookieAttributes } from "@/lib/restaurant-session-core";

/** Cookie carrying the session token. HttpOnly, so script cannot read it. */
export const CUSTOMER_SESSION_COOKIE = "crave_customer_session";

/**
 * How long a session lives.
 *
 * 90 days, renewed whenever an order is attached to it (see
 * `ensureCustomerSession` in the server wiring). Long enough that history
 * simply persists for a real customer — nobody re-orders in a way that would
 * notice — and short enough that a cookie lifted off a shared machine goes
 * stale on its own, with `revoked_at` as the immediate kill switch. The
 * partner console's 30 days is a working credential for an operator; this one
 * holds no PII at all, only order codes, which is what buys the extra month.
 */
export const CUSTOMER_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Renewal threshold: below half the TTL remaining, an attach renews.
 *
 * So a customer ordering regularly keeps one session for years (each attach
 * pushes `expires_at` a full TTL out) while a dormant one lapses a fixed 90
 * days after its last attach. The cookie is rewritten in the same breath —
 * `expires_at` is only ever extended on a response that also sets the cookie,
 * so the browser's `Max-Age` and the row's window can never drift apart.
 */
export const CUSTOMER_SESSION_RENEW_BELOW_MS = CUSTOMER_SESSION_TTL_MS / 2;

/**
 * How many order codes a session remembers.
 *
 * The history surfaces read at most 30 (matching the legacy lookup cap), so
 * 60 keeps two screens' worth of headroom without letting a high-volume
 * browser grow the row unbounded. Older codes simply age out of the session
 * and their orders fall back to the shareable tracking link.
 */
export const CUSTOMER_SESSION_MAX_CODES = 60;

/**
 * Session token: 32 random bytes, base64url.
 *
 * Never transcribed, never rendered, never placed in a URL — it exists only in
 * the cookie and in the hashed column — so it gets the full 256 bits, the same
 * shape as the partner session token.
 */
export function makeCustomerSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The subset of a stored session row these decisions read.
 *
 * `orderCodes` is carried here rather than in a separate accessor because
 * "which codes may this session touch" is as much a part of a session's
 * answer as "is it alive" — both are read together on every authorized
 * request, and passing them as one value keeps routes from resolving the row
 * twice.
 */
export interface CustomerSessionRowLike {
  orderCodes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Whether a session row may still authenticate a request.
 *
 * `revokedAt` before `expiresAt`, exactly as `sessionIsLive` orders them: a
 * revoked session must stay refused even if a clock change would otherwise
 * keep it inside its expiry, and revocation is the check a stolen-cookie
 * report actually exercises.
 *
 * A row with no token at all is not a session, and there is nothing to
 * compare — the caller treats "not found" and "unusable" identically, so a
 * guessed cookie cannot be told apart from a revoked one.
 */
export function customerSessionIsLive(
  row: CustomerSessionRowLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!row) return false;
  if (row.revokedAt) return false;
  return row.expiresAt.getTime() > now;
}

/**
 * Normalise an order code for the bound list: trimmed and uppercased.
 *
 * Codes are minted uppercase (`CRV-XXXXX`) and `verifyOrderToken` uppercases
 * its payload too, but the URL parameter and legacy localStorage entries have
 * carried mixed case before — normalising on both write and read is what
 * keeps `includes()` from a case mismatch denying the owner their own order.
 */
export function normalizeOrderCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase();
}

/**
 * Normalise a batch for binding: cleaned, deduplicated, capped, recency-first.
 *
 * Deduplicated because the bound list is a set (the same order attached twice
 * — a checkout retry plus a boot-time flush — must not occupy two slots) and
 * recency-first because the cap drops from the tail, and the tail is exactly
 * where stale codes belong.
 */
export function normalizeOrderCodes(codes: Iterable<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of codes) {
    const code = normalizeOrderCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= CUSTOMER_SESSION_MAX_CODES) break;
  }
  return out;
}

/** Cookie attributes for the session cookie. */
export interface CustomerCookieOptions {
  maxAgeSeconds: number;
  /** `true` when the request that will carry this cookie was HTTPS. */
  secure: boolean;
}

/**
 * Serialise the session cookie as a `Set-Cookie` value.
 *
 * Built here (with the partner session's shared attribute helper) rather than
 * passed to a `cookies().set` call so the attributes that matter are
 * assertable in tests:
 *
 *   - `HttpOnly`  the whole point: script cannot read the credential, so an
 *                 XSS cannot exfiltrate it the way it could read the order
 *                 tokens that used to sit in web storage.
 *   - `SameSite=Lax`  sent on same-origin fetches and top-level navigation
 *                 (both things a customer does), withheld on cross-site
 *                 subrequests and form POSTs — the first, independent layer
 *                 under `guardWrite`'s origin check.
 *   - `Secure`    whenever the request itself arrived over TLS, so the
 *                 attribute follows the deployment rather than an env var
 *                 that is wrong in one of the two environments.
 *   - `Path=/`    order routes live under `/api/orders/*` and `/order/*`, so
 *                 the cookie has to be sent across both.
 */
export function buildCustomerSessionCookie(token: string, opts: CustomerCookieOptions): string {
  return [
    `${CUSTOMER_SESSION_COOKIE}=${token}`,
    ...cookieAttributes({ ...opts, httpOnly: true }),
  ].join("; ");
}

/**
 * The `Set-Cookie` value that removes the session.
 *
 * `Max-Age=0` rather than an `Expires` in the past, with the same `Path` and
 * `Secure` as the cookie it replaces — a deletion whose attributes do not
 * match the original is silently ignored, which looks to the user like
 * "clear my history link" did nothing while the cookie keeps riding every
 * request.
 */
export function buildClearedCustomerSessionCookie(opts: { secure: boolean }): string {
  return [
    `${CUSTOMER_SESSION_COOKIE}=`,
    ...cookieAttributes({ maxAgeSeconds: 0, secure: opts.secure, httpOnly: true }),
  ].join("; ");
}
