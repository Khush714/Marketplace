import "server-only";

/**
 * Server wiring for the anonymous customer session: resolve the cookie, mint
 * one, renew it, and append `Set-Cookie` to a response.
 *
 * The policy half lives in `@/lib/customer-session-core.ts` (testable without
 * the `server-only` marker); the row half lives in `@/db/queries.ts`. This
 * file is the thin seam routes actually call — there are deliberately no
 * decisions here beyond "which of those do I call, and when".
 *
 * Routes take a plain `Request`, not a `NextRequest`, so the cookie is read
 * from the `Cookie` header by hand rather than through `req.cookies`; the
 * parsing is five lines and avoids dragging Next's request type through every
 * order route for one header.
 *
 * The two places it is called:
 *
 *   - `POST /api/orders/attach` — `ensureCustomerSession`, then append the
 *     cookie iff `expiresAt` came back set (created or renewed). That is the
 *     invariant: the cookie is written exactly when the row's window changed,
 *     so the browser's `Max-Age` and `expires_at` never drift apart.
 *   - the order read routes (`[code]`, pay, cancel, lookup) —
 *     `resolveCustomerSession`, which only ever touches `lastUsedAt` and
 *     never writes the cookie. A read that renewed the row without rewriting
 *     the cookie is how a "permanent" session slowly dies at the browser.
 */

import {
  createCustomerSession,
  getCustomerSession,
  renewCustomerSession,
  touchCustomerSession,
  type CustomerSession,
} from "@/db/queries";
import {
  buildCustomerSessionCookie,
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_RENEW_BELOW_MS,
  customerSessionIsLive,
} from "@/lib/customer-session-core";
import { cookieShouldBeSecure } from "@/lib/security/restaurant-session";

/**
 * The session token from the request's `Cookie` header, or "".
 *
 * Manual parse rather than a cookie library: one named cookie, split on `;`,
 * trim, done. No `decodeURIComponent` — the token is base64url and contains
 * no characters that decoding would change, and decoding a malformed value
 * would only ever produce something that then fails to hash-match, which the
 * caller already treats as "no session".
 */
export function readCustomerSessionToken(headers: Headers): string {
  const raw = headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== CUSTOMER_SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value === "" ? "" : value;
  }
  return "";
}

/**
 * The request's live customer session, or null.
 *
 * Expired, revoked, unknown and absent are all the same answer on purpose —
 * a caller authorizing an order learns only "no session", so a guessed
 * cookie is indistinguishable from a revoked one from outside. The
 * `lastUsedAt` touch is fire-and-forget: an audit timestamp failing to write
 * must never be the reason a customer cannot read their own order.
 */
export async function resolveCustomerSession(req: Request): Promise<CustomerSession | null> {
  const token = readCustomerSessionToken(req.headers);
  if (!token) return null;
  const session = await getCustomerSession(token);
  if (!session || !customerSessionIsLive(session)) return null;
  void touchCustomerSession(session.id).catch(() => {});
  return session;
}

/** What `ensureCustomerSession` found or made, plus what the cookie needs. */
export interface EnsuredCustomerSession {
  session: CustomerSession;
  /** The token naming the row — carried through so the caller can set the cookie without re-reading it. */
  token: string;
  /**
   * Fresh expiry when the session was created or renewed, null when the
   * existing cookie is still in step with the row.
   *
   * Null is not an error: it means "this response must NOT write the cookie",
   * which is the rule that keeps `expires_at` and the cookie's `Max-Age` from
   * drifting. Callers branch on this and nothing else.
   */
  expiresAt: Date | null;
}

/**
 * The request's session, creating or renewing one when needed.
 *
 * Called only from `POST /api/orders/attach`, the one route that both
 * changes the row's window and is allowed to set the cookie. Three cases:
 *
 *   - a live session more than half its TTL from expiry → reuse it, return
 *     `expiresAt: null`, touch nothing durable (the attach's own bind write
 *     stamps `last_used_at` anyway);
 *   - a live session inside the renewal threshold → push `expires_at` a full
 *     TTL out and report the new expiry, so the cookie rides along;
 *   - missing, expired or revoked → mint a fresh row. Never resurrects the
 *     old one: the token's window is closed, and binding the new session
 *     from the attach's verified pairs gives the browser its history back
 *     through the normal path rather than through a special-case "renew the
 *     dead" branch.
 */
export async function ensureCustomerSession(req: Request): Promise<EnsuredCustomerSession> {
  const token = readCustomerSessionToken(req.headers);
  if (token) {
    const existing = await getCustomerSession(token);
    if (existing && customerSessionIsLive(existing)) {
      const live = existing;
      if (live.expiresAt.getTime() - Date.now() < CUSTOMER_SESSION_RENEW_BELOW_MS) {
        const expiresAt = await renewCustomerSession(live.id);
        return { session: { ...live, expiresAt }, token, expiresAt };
      }
      return { session: live, token, expiresAt: null };
    }
  }
  const minted = await createCustomerSession();
  return {
    session: { id: minted.id, orderCodes: [], expiresAt: minted.expiresAt, revokedAt: null },
    token: minted.sessionToken,
    expiresAt: minted.expiresAt,
  };
}

/**
 * Append the session cookie to a response about to be sent.
 *
 * Mirrors `setSessionCookies` in shape — take the `Response`, append to its
 * headers — so routes build their answer first and set credentials in one
 * place, instead of each one re-deriving `maxAge` from `expiresAt` and
 * eventually disagreeing about an hour. `Secure` follows the request through
 * the partner session's shared `cookieShouldBeSecure`.
 */
export function appendCustomerSessionCookie(
  req: Request,
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  res.headers.append(
    "Set-Cookie",
    buildCustomerSessionCookie(token, { maxAgeSeconds, secure: cookieShouldBeSecure(req) }),
  );
}
