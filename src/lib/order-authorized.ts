import "server-only";

/**
 * Dual authorization for the per-order routes: a signed header token OR a
 * live customer session that owns the code.
 *
 * Two ways in, on purpose. The header token (`x-order-token`, minted at
 * checkout and held beside the order in web storage) is the bearer credential
 * the app has always used — it works from a fresh tab, a shared link on the
 * same device, and any request the client builds by hand. The session is the
 * new one: an HttpOnly cookie naming which codes *this browser* may touch, so
 * a customer can read their history without the client replaying a stack of
 * tokens from localStorage — and so a script that can read storage still
 * cannot exfiltrate anything to replay elsewhere (the cookie stays in the
 * browser's jar where script cannot see it).
 *
 * Accepting either is what keeps the migration honest: old sessions with
 * legacy tokens and new ones with just a cookie both work, and neither path
 * is weaker than the old one — the header is still HMAC-verified, the session
 * still only ever grants codes it was explicitly bound to.
 *
 * Every failure answer is "not authorized", with no distinction between a
 * wrong header, a foreign session and an unknown code: routes turn that into
 * a 404 identical to a genuinely missing order, so this helper never leaks
 * whether a code exists to somebody who does not hold it.
 */

import { normalizeOrderCode } from "@/lib/customer-session-core";
import { resolveCustomerSession } from "@/lib/customer-session";
import { readOrderToken, verifyOrderToken } from "@/lib/order-token";

/**
 * Whether `req` may act on `code` — read it, pay for it, or cancel it.
 *
 * The header check runs first and alone when it succeeds: a valid token is
 * the stronger credential of the two, and short-circuiting skips the session
 * read (and its `lastUsedAt` write) on the path most client code still takes
 * today. Only when there is no usable header does the request fall through to
 * the cookie, which is also the path that keeps history pages working after
 * the client stops storing tokens at all.
 */
export async function orderAuthorized(req: Request, code: unknown): Promise<boolean> {
  const normalized = normalizeOrderCode(code);
  if (!normalized) return false;

  const headerToken = readOrderToken(req.headers);
  if (headerToken && verifyOrderToken(normalized, headerToken)) return true;

  const session = await resolveCustomerSession(req);
  if (!session) return false;
  return session.orderCodes.includes(normalized);
}
