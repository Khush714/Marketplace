import { NextRequest } from "next/server";
import { issueDeleteConfirmation } from "@/db/queries";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

/**
 * Mint the single-use confirmation that `DELETE /api/partner/restaurant` demands.
 *
 * ## What problem this actually solves
 *
 * The typed restaurant name that already guards the delete is not a security
 * control. The name is public — it is in the page title, in search results, and in
 * the restaurant's own URL — so anyone holding a session (a shared till, a stale
 * browser profile, a screenshot that leaked the old owner key) can read the exact
 * string the confirmation asks for off the website. Typing it proves that a person
 * was paying attention, not that they were authorised.
 *
 * This token is the part that is not derivable. It is:
 *
 *   - **unguessable** — 32 random bytes, checked against a stored hash;
 *   - **bound to one session** — held on the `restaurant_sessions` row, so a token
 *     taken from one device is worthless on another;
 *   - **short-lived** — ten minutes, which is long enough to read a dialog and type
 *     a name and short enough not to be a standing capability;
 *   - **single-use** — `consumeDeleteConfirmation` clears it on the first attempt,
 *     successful or not, so one stolen token buys exactly one try.
 *
 * ## Why it is issued on demand instead of at sign-in
 *
 * A confirmation minted eagerly would sit valid in the database for the whole
 * 30-day session. That is a much longer window than the operation it authorises
 * deserves, and it would mean a database read alone was enough to authorise
 * destroying a restaurant's order history. Issuing it when the operator asks for it
 * keeps the live window to the ten minutes the UI actually needs.
 *
 * ## What issuing it does *not* require
 *
 * No confirmation of the name, no password, nothing beyond a live session and a
 * CSRF token. This endpoint cannot delete anything — it only hands out a token that
 * is useless without the typed name and the delete's own four gates. Making it
 * harder would not add security, it would add a step between the partner and their
 * own listing, which is the trade this whole change is trying to avoid.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const confirmation = await issueDeleteConfirmation(auth.session.id);
  return Response.json({
    ok: true,
    deleteToken: confirmation.token,
    expiresAt: confirmation.expiresAt.toISOString(),
  });
}
