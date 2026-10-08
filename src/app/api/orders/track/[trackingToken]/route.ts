import { getOrderByTrackingToken } from "@/db/queries";
import { toPublicOrder } from "@/lib/order-public";
import { isTrackingToken } from "@/lib/order-tracking";
import { guardRead } from "@/lib/abuse";
import { emitSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

/**
 * Customer order tracking by the Phase 6 tracking token — the bearer credential
 * behind `/order/<tracking-token>`.
 *
 * Unlike the code-based route this URL is shareable: the token is the
 * credential, so no header handshake is needed and any device can follow it.
 * That is exactly why the token must be 128 bits of CSPRNG output, and why the
 * row only stores its sha256 hash: a token that lives in a URL is a token that
 * sits in logs and referrers, so it must be unguessable and irrecoverable from
 * the database.
 *
 * The response is the same customer-safe projection `toPublicOrder` used by the
 * code-based route — order code, restaurant, items, status, ETA, totals, created
 * time, delivery address — never the internal numeric ids, the POS external
 * order id, or the phone.
 *
 * The order code on its own still grants nothing: this route reads the hash of
 * a valid 22-char base64url token and nothing else, and legacy `CRV-XXXXX`
 * codes fail the shape check before a query runs.
 */
export async function GET(req: Request, ctx: { params: Promise<{ trackingToken: string }> }) {
  const { trackingToken } = await ctx.params;
  if (!isTrackingToken(trackingToken)) {
    // Phase 12: a shape failure means someone is probing the tracking URL
    // pattern — real customers arrive with a token minted by this app, which
    // always passes this check. The presented value is never logged: it is
    // the credential, and a log reader must not be able to replay it.
    emitSecurityEvent("order_tracking_suspicious", {
      outcome: "failure",
      reason: "malformed_token",
    });
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const throttled = guardRead(req, "orderLookup");
  if (throttled) return throttled;
  const order = await getOrderByTrackingToken(trackingToken);
  if (!order) {
    // Well-formed but unknown: either an expired/rotated token or a guess in
    // the right shape. Still never the token itself — only why it failed.
    emitSecurityEvent("order_tracking_suspicious", {
      outcome: "failure",
      reason: "unknown_token",
    });
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ order: toPublicOrder(order) });
}