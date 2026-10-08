import "server-only";

/**
 * Server wiring for the partner session: cookie in, restaurant id out.
 *
 * The policy — token shape, lifetimes, cookie attributes, what counts as a live
 * session — lives in `restaurant-session-core.ts` so it can be unit-tested without
 * the `server-only` marker. This file is the part that needs a request and a
 * database: reading the cookie, resolving the session, and answering a route with
 * the right refusal.
 *
 * ## What this replaces, and why it was worth doing
 *
 * Every `/api/partner/*` route used to read `x-owner-key` and re-hash it against
 * `restaurants.owner_key_hash`. That made the owner key three things at once: the
 * recovery credential, the request authenticator, and the session. The third role
 * is what it could not do. A session needs an expiry, a revocation, and a server
 * record of who is signed in; an owner key has none of those. So a stolen key
 * could not be signed out — only rotated, which invalidates the copy the
 * restaurant actually holds — and the key had to be transmitted on every single
 * request, which is why it was in headers and URL query strings in the first
 * place.
 *
 * The owner key is still the way in. It is just used once.
 */

import type { NextRequest } from "next/server";

import { getRestaurantSession, touchRestaurantSession, type RestaurantSession } from "@/db/queries";
import { originDecision } from "@/lib/abuse";
import { checkRateLimit, rateLimited } from "@/lib/security/rate-limit";
import {
  buildClearedSessionCookies,
  buildCsrfCookie,
  buildSessionCookie,
  csrfMatches,
  RESTAURANT_CSRF_HEADER,
  RESTAURANT_SESSION_COOKIE,
  sessionIsLive,
} from "@/lib/restaurant-session-core";

/**
 * Per-session budgets.
 *
 * Both are far above what a person does. A partner editing a menu might make a few
 * hundred writes across an evening and one read per keystroke-driven reload; the
 * numbers are set where they stop sustained scripted volume and nowhere near
 * where they cost a real restaurant its console.
 *
 * Keyed on the *resolved session*, not the client address. By the time these run
 * the caller is authenticated, so the honest bucket is "this restaurant", and an
 * IP bucket would let one restaurant behind a shared NAT spend another's budget.
 */
const PARTNER_READ_BUDGET = { limit: 240, windowMs: 60_000 };
const PARTNER_WRITE_BUDGET = { limit: 120, windowMs: 60_000 };

/** Read the session token from the request's cookies. */
export function readSessionToken(req: NextRequest): string {
  return String(req.cookies.get(RESTAURANT_SESSION_COOKIE)?.value ?? "").trim();
}

/**
 * Whether the cookie for this request should carry `Secure`.
 *
 * Read from the request rather than from an env var, because the env var is wrong
 * in one of the two environments: `NODE_ENV === "production"` is true for an
 * internal HTTP-only origin as well as for the public HTTPS one. The edge sets
 * `x-forwarded-proto`; trusting it to *add* an attribute is safe, because the
 * failure mode of being wrong is a cookie marked `Secure` on an HTTP dev host,
 * which the browser drops — not a cookie shipped in the clear over HTTPS.
 */
export function cookieShouldBeSecure(req: NextRequest): boolean {
  const proto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Attach the session's cookies to a response about to be sent.
 *
 * Takes the `Response` rather than returning one so a route can build its answer
 * first and attach the cookies in one place, instead of each route re-deriving
 * `maxAge` and `Secure` and eventually disagreeing about one of them.
 *
 * Two cookies, deliberately different in exactly one attribute: the session token
 * is `HttpOnly` and unreadable from script, the CSRF token is readable and must be
 * sent back as a header. See {@link RESTAURANT_CSRF_COOKIE} for why that is not a
 * contradiction.
 */
export function setSessionCookies(
  res: Response,
  session: { sessionToken: string; csrfToken: string; expiresAt: Date },
  secure: boolean,
): void {
  const maxAgeSeconds = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  const opts = { maxAgeSeconds, secure };
  res.headers.append("Set-Cookie", buildSessionCookie(session.sessionToken, opts));
  res.headers.append("Set-Cookie", buildCsrfCookie(session.csrfToken, opts));
}

/**
 * Attach the cookies that end the session.
 *
 * The matching `Path` and `Secure` matter: a deletion that does not match the
 * original cookie's attributes is silently ignored by the browser, which the user
 * experiences as sign-out having done nothing while the cookie is still being
 * attached to every request.
 */
export function clearSessionCookies(res: Response, secure: boolean): void {
  for (const cookie of buildClearedSessionCookies({ secure })) {
    res.headers.append("Set-Cookie", cookie);
  }
}

export type PartnerSessionResult =
  | { ok: true; session: RestaurantSession }
  | { ok: false; response: Response };

/**
 * Require a live partner session, and for writes a matching CSRF token.
 *
 * The checks run cheapest-and-most-decisive first, and that order is a security
 * property rather than a style choice:
 *
 *   1. **Origin**, on writes only. A cross-site caller is refused before it costs
 *      a query. `SameSite=Lax` already blocks the common cases, but it is one
 *      browser heuristic; this is a second, independent one. This check was
 *      unnecessary on these routes before and is not any more — `x-owner-key`
 *      gave the partner API CSRF protection for free (a custom header forces a
 *      CORS preflight a cross-origin form cannot pass) and a cookie takes exactly
 *      that away. `unknown` callers pass: this guard exists to stop a *browser*
 *      being used as a confused deputy, and refusing curl would break the test
 *      suite to stop an attack it is not part of.
 *   2. **Session.** Hashed, resolved, and either live or refused.
 *   3. **CSRF**, on writes. Unforgeable by a same-origin script that did not
 *      fetch it, which is what makes the origin check above defence in depth
 *      rather than the whole defence.
 *   4. **Budget.** Keyed on the resolved session.
 *
 * On failure the caller gets a ready `Response` rather than a status and an
 * error string, so a route cannot accidentally send a 200 with a failure body.
 */
export async function requirePartnerSession(
  req: NextRequest,
  opts: { mutating: boolean },
): Promise<PartnerSessionResult> {
  if (opts.mutating && originDecision(req) === "cross-site") {
    return { ok: false, response: Response.json({ ok: false, error: "Request rejected" }, { status: 403 }) };
  }

  const token = readSessionToken(req);
  const session = await getRestaurantSession(token);
  if (!sessionIsLive(session)) {
    // 401 with a code, not a bare 404: the console needs to distinguish "your
    // session expired, sign in again" from "no such listing", and an attacker
    // gets the same answer either way.
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Sign in with your owner key", code: "SESSION_REQUIRED" },
        { status: 401 },
      ),
    };
  }

  // Non-null because sessionIsLive proved it; the assertion is what keeps the rest
  // of this function free of `!`.
  const live = session as RestaurantSession;

  if (opts.mutating) {
    if (!csrfMatches(live.csrfHash, req.headers.get(RESTAURANT_CSRF_HEADER))) {
      return {
        ok: false,
        response: Response.json(
          { ok: false, error: "Request rejected", code: "CSRF_INVALID" },
          { status: 403 },
        ),
      };
    }

    const budget = checkRateLimit(
      `partner-write:${live.restaurantId}`,
      PARTNER_WRITE_BUDGET.limit,
      PARTNER_WRITE_BUDGET.windowMs,
    );
    if (!budget.allowed) {
      return { ok: false, response: rateLimited(budget.retryAfterSeconds) };
    }
  } else {
    const budget = checkRateLimit(
      `partner-read:${live.restaurantId}`,
      PARTNER_READ_BUDGET.limit,
      PARTNER_READ_BUDGET.windowMs,
    );
    if (!budget.allowed) {
      return { ok: false, response: rateLimited(budget.retryAfterSeconds) };
    }
  }

  // Deliberately not awaited: failing to write an audit timestamp must never be
  // the reason a restaurant cannot load its menu.
  void touchRestaurantSession(live.id).catch(() => {});

  return { ok: true, session: live };
}

/**
 * Budget for the one irreversible action in the console.
 *
 * Three per hour, keyed on the session rather than the address. This is much
 * tighter than any other budget in the app, on purpose: every other limit is set
 * where it stops sustained scraping, but there is no legitimate reason to *attempt*
 * a listing deletion more than a few times, and the operation removes orders that
 * cannot be recovered. A restaurant that fat-fingers its own name three times is a
 * support ticket, not a rate-limit problem — and the name is now only one of four
 * things that must line up, so a genuine typo no longer gets anywhere near the
 * cascade.
 */
const RESTAURANT_DELETE_BUDGET = { limit: 3, windowMs: 60 * 60_000 };

/**
 * Refuse a destructive attempt that is over budget.
 *
 * Keyed on the session id, so it follows the credential rather than the network:
 * an attacker who has stolen a session cannot spread a burst of delete attempts
 * across a botnet's addresses to get past it, and a restaurant is not throttled
 * because it shares an address with someone else's session.
 */
export function guardRestaurantDeletion(session: RestaurantSession): Response | null {
  const budget = checkRateLimit(
    `partner-delete:${session.id}`,
    RESTAURANT_DELETE_BUDGET.limit,
    RESTAURANT_DELETE_BUDGET.windowMs,
  );
  return budget.allowed ? null : rateLimited(budget.retryAfterSeconds);
}
