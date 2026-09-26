import { NextRequest } from "next/server";
import {
  authenticateIntegration,
  createIntegrationSession,
  getOrCreateMarketplaceId,
  recordIntegrationAudit,
} from "@/db/queries";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let code: string;
  let passkey: string;
  try {
    const body = await req.json();
    code = String(body?.code ?? "").trim();
    passkey = String(body?.passkey ?? "");
  } catch {
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }
  const identity = await authenticateIntegration(code, passkey);
  if (!identity) {
    return Response.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  const marketplaceId = await getOrCreateMarketplaceId(identity.restaurant.id);
  const { token, expiresAtIso } = await createIntegrationSession(identity);

  await recordIntegrationAudit(
    identity.restaurant.id,
    "session.created",
    { actor: "restaurant", ipAddress: req.headers.get("x-forwarded-for") },
    { tokenExpiresAt: expiresAtIso },
  );

  return Response.json({
    ok: true,
    restaurant: { ...identity.restaurant, marketplaceId },
    token,
    tokenExpiresAt: expiresAtIso,
  });
}