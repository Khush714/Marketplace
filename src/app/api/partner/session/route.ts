import { NextRequest } from "next/server";
import {
  createRestaurantSession,
  getRestaurantManageById,
  revokeRestaurantSession,
  verifyOwner,
} from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";
import {
  clearSessionCookies,
  cookieShouldBeSecure,
  requirePartnerSession,
  setSessionCookies,
} from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

/**
 * The owner key's last job: exchange itself for a session, once.
 *
 *   connection -> owner key generated once -> restaurant authenticates here
 *              -> server creates a restaurant session -> HttpOnly cookie
 *
 * Everything after this point rides the session. That is the whole of the change:
 * the key used to be re-sent on every partner request, which meant it had to
 * travel in a header or a URL, which is why it kept turning up in access logs,
 * proxy logs and browser history. It is now sent exactly once, over POST, in a
 * request body — the one place a credential is not logged by default.
 *
 * The key is deliberately NOT retired. It remains the recovery credential: a
 * partner who clears their browser, moves to a new device, or is signed out by a
 * 30-day expiry comes back here with it. What changed is that holding it is no
 * longer *necessary* to use the console — so it is not exposed on every request,
 * and it can be rotated (which revokes every device) without locking the
 * restaurant out of the business it just handed the key to.
 *
 * `guardWrite(req, "ownerVerify")` carries the whole route's abuse policy in one
 * call: origin first (a session is only ever minted from this app's own UI), then
 * the budget, then the body cap. The budget is the `ownerVerify` scope because this
 * is the credential-check endpoint — the one a script tests a harvested key
 * against — and its 404 confirms when a key is live.
 */
export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "ownerVerify");
  if (blocked) return blocked;

  let ownerKey: string;
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { ownerKey?: unknown } | null;
    ownerKey = String(body?.ownerKey ?? "").trim();
  }

  const restaurant = await verifyOwner(ownerKey);
  // 404, not 401: a caller must not learn whether a guessed key belongs to a real
  // listing, and a 401 is the more informative answer to script against.
  if (!restaurant) {
    return Response.json({ ok: false, error: "Invalid owner key" }, { status: 404 });
  }

  const session = await createRestaurantSession(restaurant.id);
  const res = Response.json({
    ok: true,
    restaurant,
    // Not returned in the body. It goes out as a readable cookie and comes back on
    // a header, so it survives a reload and stays identical across tabs — a body
    // value would be lost on refresh, and re-minting it per load would invalidate
    // whichever tab loaded second.
    expiresAt: session.expiresAt.toISOString(),
  });
  setSessionCookies(res, session, cookieShouldBeSecure(req));
  return res;
}

/**
 * Who am I?
 *
 * Lets a page open already signed in, without asking for the owner key again, and
 * tells it when the session is about to expire so the console can prompt before a
 * half-typed menu edit hits an expired cookie.
 *
 * The CSRF token is not in this response because it cannot be: the server stores
 * only a hash, and a hash is not reversible. The browser already has it, in the
 * readable cookie this pair of routes set.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: false });
  if (!auth.ok) return auth.response;

  const restaurant = await getRestaurantManageById(auth.session.restaurantId);
  if (!restaurant) {
    // The session outlived its restaurant. Only reachable if a listing was removed
    // out from under a live session, so it is treated as a dead session and the
    // cookie is cleared rather than left attached to a session that can never
    // authenticate anything.
    const res = Response.json(
      { ok: false, error: "That listing no longer exists", code: "SESSION_REQUIRED" },
      { status: 401 },
    );
    clearSessionCookies(res, cookieShouldBeSecure(req));
    return res;
  }

  return Response.json({
    ok: true,
    restaurant,
    sessionExpiresAt: auth.session.expiresAt.toISOString(),
  });
}

/**
 * Sign this device out.
 *
 * Revokes the row rather than only clearing the cookie. Clearing alone would leave
 * a working token in a browser we have no way to prove stopped using it — the copy
 * a partner pasted into a support ticket, or the one on a machine they gave away.
 * Revoking is what makes "sign out" mean something beyond "please stop attaching
 * this".
 *
 * Requires the CSRF token even though it changes nothing beyond ending the
 * caller's own session: without it, a cross-site page could sign a restaurant out
 * of its console at will, which is a denial of service dressed up as a logout.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  await revokeRestaurantSession(auth.session.id);

  const res = Response.json({ ok: true });
  clearSessionCookies(res, cookieShouldBeSecure(req));
  return res;
}
