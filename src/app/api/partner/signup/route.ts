import { NextRequest } from "next/server";
import { createRestaurantSession, selfRegisterRestaurant, type ListingProfileInput } from "@/db/queries";
import { checkRateLimit, clientKey, rateLimited } from "@/lib/security/rate-limit";
import { bodyTrippedHoneypot, honeypotRejected, originDecision, readJsonBody } from "@/lib/abuse";
import { cookieShouldBeSecure, setSessionCookies } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

/**
 * Self-serve restaurant onboarding — the UI-only replacement for an
 * ops-minted `CNX-…` code.
 *
 * Why this is safe to leave open, given `POST /api/partner/codes` is not:
 *
 *   - A minted code was a *capability to create a listing*. Anyone who could
 *     mint one could enrol arbitrary restaurants. Here the capability is the
 *     restaurant's own listing details plus the rate limit below; there is no
 *     secret to steal, because none is issued.
 *   - Nothing becomes live here. `selfRegisterRestaurant` writes
 *     `is_active = false`, and discoverability needs `is_active` AND a
 *     published menu item, so a brand-new listing is invisible in browse and in
 *     search.
 *   - Nothing becomes *orderable* either. Checkout is gated on
 *     `hasActiveIntegration`, which requires an ACTIVE integration record with a
 *     POS restaurant id and a sealed webhook secret. Those only exist after the
 *     restaurant claims a connection code from its own POS on
 *     /partner/integrations — so a POS connection code remains the real proof
 *     of ownership. Self-signup removes the operator from the funnel; it does
 *     not remove the proof.
 *
 * What an open endpoint does leave open is *volume*: a junk-listing flood. That
 * is bounded here by a per-caller budget far tighter than the redemption budget
 * (a restaurant signs up once, ever) and by the fact that every row is inert
 * until a human at a real POS connects it.
 *
 * Ordering matters and is deliberate. The budget is charged LAST, after the
 * origin check, the size cap and the honeypot. Charging first would let a bot
 * sitting behind the same NAT spend a real restaurant's three signups before
 * its own request was ever inspected — the limiter would become the tool it
 * used to deny service, rather than the thing stopping it.
 *
 * Deliberately NOT implemented: email/phone verification. There is no mail or
 * SMS provider in this codebase, and adding one to gate onboarding would make
 * the funnel depend on a third party that can fail closed with no way in. The
 * POS claim is the stronger control, and it is already mandatory to go live.
 */
const SIGNUP_LIMIT = 3;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (originDecision(req) === "cross-site") {
    return Response.json({ ok: false, error: "Request rejected" }, { status: 403 });
  }

  let body: ListingProfileInput;
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    // Hidden field a person cannot see or tab into. A form bot that does not
    // parse the DOM fills in every text input it finds; the trip is answered
    // with `{ ok: true }` so the bot learns nothing about which field gave it
    // away, and costs nothing because the budget below is never reached.
    if (bodyTrippedHoneypot(parsed.body)) return honeypotRejected();
    body = parsed.body as ListingProfileInput;
  }

  const limit = checkRateLimit(clientKey(req, "partner-signup"), SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

  const result = await selfRegisterRestaurant(body);
  if (!result.ok) {
    // 409 rather than 400: the store id is a real conflict, and the partner UI
    // wants to branch on it to point an existing restaurant at "load your
    // listing" instead of showing a dead-end validation message.
    return Response.json(result, { status: result.code === "STORE_ID_TAKEN" ? 409 : 400 });
  }

  // A fresh listing is inert (is_active = false), so minting a session here
  // carries no risk of publishing anything. It does mean the new restaurant is
  // signed into the console the moment it exists — the owner key is still shown
  // once for safekeeping, but the first request after that is already
  // authenticated and nothing needs to re-send the key.
  const session = await createRestaurantSession(result.restaurant.id);
  const res = Response.json(result, { status: 201 });
  setSessionCookies(res, session, cookieShouldBeSecure(req));
  return res;
}