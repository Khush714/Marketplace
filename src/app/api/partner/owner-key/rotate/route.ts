import { NextRequest } from "next/server";
import {
  getRestaurantByOwnerKey,
  recordIntegrationAudit,
  revokeRestaurantSessionsForRestaurant,
  rotateOwnerKeyAsRestaurant,
} from "@/db/queries";
import { readJsonBody } from "@/lib/abuse";
import { checkRateLimit, clientKey, rateLimited } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/partner/owner-key/rotate   { currentOwnerKey }
 *
 * Partner-initiated rotation of the Marketplace owner key.
 *
 * Authenticated by the key being replaced, so this is a change-credential
 * operation and not a privilege escalation: possessing the old key is exactly
 * the proof required. It writes `owner_key_hash` ONLY — `integration_passkey_hash`
 * is a separate credential, so rotating here cannot lock the restaurant out of
 * the POS login its terminal uses (the failure mode the "split POS passkey from
 * owner key" migration fixed).
 *
 * This is NOT a recovery path. A restaurant that has lost the key cannot use it,
 * by design: an endpoint that mints a replacement for "I don't have my key"
 * hands every attacker who knows a restaurant's name full control of its menu
 * and listing. Lost-key recovery stays with ops for that reason; the change this
 * removes is the round-trip for a partner who still holds the key and wants a
 * new one.
 */
const ROTATE_LIMIT = 5;
const ROTATE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const limit = checkRateLimit(clientKey(req, "partner-owner-key-rotate"), ROTATE_LIMIT, ROTATE_WINDOW_MS);
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

  // Capped read: a chunked body declares no length, so parsing the request body
  // directly would buffer whatever the caller streams into a route whose only
  // input is one key.
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { currentOwnerKey?: unknown };
  const key = String(body.currentOwnerKey ?? "").trim();
  if (!key) {
    return Response.json({ ok: false, error: "Enter your current owner key" }, { status: 400 });
  }

  const restaurant = await getRestaurantByOwnerKey(key);
  // 404 for both "no such key" and "key did not rotate" so this cannot be used
  // to confirm that a guessed key belongs to a real listing.
  if (!restaurant) return Response.json({ ok: false, error: "Not found" }, { status: 404 });

  const result = await rotateOwnerKeyAsRestaurant(restaurant.id, key);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }

  // The old key is dead; every session ever minted by it must be too. Without
  // this, someone who held the key before rotation keeps a live session for up
  // to 30 days after the key they used to mint it stopped working — the very
  // thing rotation is supposed to end. The operator signs back in with the new
  // key, which is shown exactly once in the response.
  await revokeRestaurantSessionsForRestaurant(restaurant.id);
  await recordIntegrationAudit(restaurant.id, "owner_key.rotated_by_partner", { actor: "partner" });

  return Response.json({
    ok: true,
    ownerKey: result.ownerKey,
    warning: "Shown once. Your previous owner key no longer works on any device.",
  });
}