import { NextRequest } from "next/server";
import {
  recordIntegrationAudit,
  revokeIntegrationSessions,
  rotatePasskeyAsRestaurant,
} from "@/db/queries";
import { guardBudget } from "@/lib/abuse";
import { emitSecurityEvent } from "@/lib/security/security-events";
import { requireIntegrationAuth } from "../../_auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/passkey/rotate
 *
 *   Authorization: Bearer <integration-session>
 *
 * Rotates the passkey for the restaurant OWNING the presented session — the
 * session is the proof, so no code or current passkey travels in the body
 * (requiring the secret being replaced on the wire is exactly what a proper
 * session exchange is supposed to retire). The new passkey is returned exactly
 * once; the caller must store it securely and sign back in with it.
 *
 * Every minted session for the restaurant is revoked afterwards. Anyone who
 * held the old passkey long enough to mint a session must not outlive the
 * rotation in it — and the caller, who just got the new passkey, re-authenticates
 * with that instead.
 *
 * Budgeted under `passkeyRotate` (see ABUSE_BUDGETS), and charged BEFORE the
 * session check: each call is a rotation plus a revocation of every session
 * the restaurant holds, so both a stolen session grinding it and an
 * unauthenticated flood have to be paid for rather than answered for free.
 */
export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "passkeyRotate");
  if (blocked) return blocked;

  const restaurant = await requireIntegrationAuth(req);
  if (!restaurant) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const result = await rotatePasskeyAsRestaurant(restaurant.id);
  if (!result.ok) {
    // The session authenticated but the rotation was refused — recorded as a
    // failed rotation, with neither the old nor the new passkey present.
    emitSecurityEvent("passkey_rotated", {
      restaurantId: restaurant.id,
      outcome: "failure",
      reason: "rotation_refused",
    });
    return Response.json(result, { status: 401 });
  }

  await revokeIntegrationSessions(restaurant.id);
  await recordIntegrationAudit(
    restaurant.id,
    "passkey.rotated",
    { actor: "restaurant", ipAddress },
    { sessionsRevoked: true },
  );
  // Phase 12: rotation complete, all sessions revoked. `result` also carries
  // the new passkey — only the restaurant id crosses into the event.
  emitSecurityEvent("passkey_rotated", {
    restaurantId: restaurant.id,
    outcome: "success",
  });

  return Response.json(result);
}