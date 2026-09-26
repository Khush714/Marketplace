import { NextRequest } from "next/server";
import {
  recordIntegrationAudit,
  rotatePasskey,
  rotatePasskeyAsRestaurant,
} from "@/db/queries";
import { requireIntegrationAuth } from "../../_auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/passkey/rotate
 *
 * Preferred contract (matches the POS marketplace-client):
 *   Authorization: Bearer <token>
 *   { "current_passkey": "…" }
 *
 * Legacy fallback (code + passkey in body, no bearer):
 *   { "code": "CNX-…", "passkey": "…" }
 *
 * The passkey is returned exactly once; the caller must store it securely.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const restaurant = await requireIntegrationAuth(req);
  const ipAddress = req.headers.get("x-forwarded-for") ?? null;

  if (restaurant) {
    const result = await rotatePasskeyAsRestaurant(
      restaurant.id,
      String(body.current_passkey ?? ""),
    );
    if (!result.ok) return Response.json(result, { status: 401 });
    await recordIntegrationAudit(restaurant.id, "passkey.rotated", { actor: "restaurant", ipAddress });
    return Response.json(result);
  }

  // Legacy two-arg handshake for clients that have not adopted bearer sessions.
  const result = await rotatePasskey(
    String(body.code ?? "").trim(),
    String(body.passkey ?? ""),
  );
  if (!result.ok) return Response.json(result, { status: 401 });
  return Response.json(result);
}