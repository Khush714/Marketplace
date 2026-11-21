import { NextRequest } from "next/server";
import { createRestaurantSession, listConnections, redeemConnectionCode, type RedeemConnectionInput } from "@/db/queries";
import { requireOpsToken } from "@/lib/ops-auth";
import { checkRateLimit, clientKey, rateLimited } from "@/lib/security/rate-limit";
import { emitSecurityEvent } from "@/lib/security/security-events";
import { bodyTrippedHoneypot, honeypotRejected, originDecision, readJsonBody } from "@/lib/abuse";
import { cookieShouldBeSecure, setSessionCookies } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

/**
 * Redemption budget per caller per window.
 *
 * A real restaurant redeems one code, once, then shows the owner key. A handful
 * of retries covers a mistyped name or a double-click. 10/10min is loose enough
 * for a genuine partner and tight enough that 24.3M codes cannot be walked at a
 * useful rate from one address.
 */
const REDEEM_LIMIT = 10;
const REDEEM_WINDOW_MS = 10 * 60 * 1000;

/**
 * Enumerating every POS connection is ops-only.
 *
 * `POST` is deliberately NOT token-gated: redeeming a code is the restaurant's
 * own onboarding handshake, and the single-use code *is* the capability. The
 * abuse path that mattered — minting codes at will — is closed on
 * `POST /api/partner/codes`, so an attacker cannot manufacture a code to redeem.
 *
 * What an open redemption endpoint does leave open is *guessing* one, which is
 * why POST is rate-limited per caller.
 */
export async function GET(req: NextRequest) {
  const rejected = requireOpsToken(req);
  if (rejected) return rejected;
  return Response.json({ connections: await listConnections() });
}

/**
 * Redeem an invitation and create a LIVE listing.
 *
 * This is the most privileged unauthenticated write in the app: a successful
 * call publishes a customer-visible restaurant immediately, where
 * `POST /api/partner/signup` writes `is_active = false` and is therefore
 * comparatively cheap to get wrong. That asymmetry is the whole reason the
 * guards below are here — an earlier version of this handler parsed
 * `await req.json()` raw, while the *inert* signup route beside it already
 * origin-checked, size-capped and honeypotted.
 *
 * Layered, cheapest first, and the budget is charged LAST for the reason spelled
 * out in `POST /api/partner/signup`: charging before the cheap rejections would
 * let a bot behind the same NAT burn a real restaurant's ten attempts before its
 * own request was ever inspected.
 *
 *   1. Origin — rejects a browser lured into firing this cross-site. The code is
 *      a bearer capability, so it is never in a URL and a legitimate redemption
 *      is always same-origin.
 *   2. Body cap — `readJsonBody` bounds the payload at 16 KB by counting the
 *      stream, so an unauthenticated caller cannot make the platform buffer an
 *      arbitrary body before the first query runs.
 *   3. Honeypot — the hidden `company_url` field on /partner. Answered with
 *      `{ ok: true }` so the bot learns nothing; no budget is spent.
 *   4. Budget — the only thing standing between a 24.3M-code space and a
 *      successful guess, and the guess is what the other three only make
 *      expensive, not impossible.
 *   5. Strict validation + atomic single-use spend, in redeemConnectionCode.
 *
 * The redemption itself is unchanged and deliberately so: single-use is enforced
 * by the conditional UPDATE inside its transaction, not by anything here.
 */
export async function POST(req: NextRequest) {
  if (originDecision(req) === "cross-site") {
    return Response.json({ ok: false, error: "Request rejected" }, { status: 403 });
  }

  let body: RedeemConnectionInput;
  {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    if (bodyTrippedHoneypot(parsed.body)) return honeypotRejected();
    body = parsed.body as RedeemConnectionInput;
  }

  const limit = checkRateLimit(clientKey(req, "partner-connect"), REDEEM_LIMIT, REDEEM_WINDOW_MS);
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

  const result = await redeemConnectionCode(body);
  if (!result.ok) {
    // The failure half is the interesting one: a guessing burst against this
    // endpoint shows up exactly here. `result.error` is a fixed server-side
    // string (never the presented code), and the raw code is deliberately
    // absent from the event — an unused code in a log line is an invitation.
    emitSecurityEvent("connection_code_redeemed", {
      outcome: "failure",
      reason: result.error,
    });
    return Response.json(result, { status: 400 });
  }
  emitSecurityEvent("connection_code_redeemed", {
    outcome: "success",
    restaurantId: result.restaurant.id,
  });

  // The operator has just proven control of the listing by spending a
  // POS-issued single-use code — the strongest proof in the system. Mint the
  // session here so onboarding lands already signed in; the owner key is still
  // returned (it is the recovery credential to save), it is just not needed to
  // proceed.
  const session = await createRestaurantSession(result.restaurant.id);
  const res = Response.json(result, { status: 201 });
  setSessionCookies(res, session, cookieShouldBeSecure(req));
  return res;
}
