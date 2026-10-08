import { NextRequest } from "next/server";
import {
  authenticateIntegration,
  createIntegrationSession,
  getOrCreateMarketplaceId,
  recordIntegrationAudit,
} from "@/db/queries";
import { guardWrite, readJsonBody } from "@/lib/abuse";
import { emitSecurityEvent } from "@/lib/security/security-events";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const blocked = await guardWrite(req, "integrationLogin");
  if (blocked) return blocked;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body as { code?: unknown; passkey?: unknown } | null;
  const code = String(body?.code ?? "").trim();
  const passkey = String(body?.passkey ?? "");

  const identity = await authenticateIntegration(code, passkey);
  if (!identity) {
    // Phase 12: the failure is the security signal — this is the credential
    // check an attacker grinds. Neither the presented code nor the passkey
    // crosses into the event; the rate-limit stream (integrationLogin budget)
    // already carries the per-address context that makes it actionable.
    emitSecurityEvent("integration_login", {
      outcome: "failure",
      reason: "invalid_credentials",
    });
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  const marketplaceId = await getOrCreateMarketplaceId(identity.restaurant.id);
  const { token, expiresAtIso, idleExpiresAtIso } = await createIntegrationSession(identity, {
    ipAddress: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  await recordIntegrationAudit(
    identity.restaurant.id,
    "session.created",
    {
      actor: "restaurant",
      ipAddress: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    },
    { tokenExpiresAt: expiresAtIso, tokenIdleExpiresAt: idleExpiresAtIso },
  );

  // Phase 12: emitted after the session exists so a success line means a live
  // session was actually minted. The bearer token itself is never logged.
  emitSecurityEvent("integration_login", {
    outcome: "success",
    restaurantId: identity.restaurant.id,
  });

  return Response.json({
    ok: true,
    restaurant: { ...identity.restaurant, marketplaceId },
    token,
    tokenExpiresAt: expiresAtIso,
    tokenIdleExpiresAt: idleExpiresAtIso,
  });
}