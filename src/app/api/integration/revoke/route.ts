import { NextRequest } from "next/server";
import { recordIntegrationAudit, revokeIntegrationSessions } from "@/db/queries";
import { requireIntegrationAuth } from "../_auth";

export const dynamic = "force-dynamic";

/** POST /api/integration/revoke — invalidate every live session for the restaurant. */
export async function POST(req: NextRequest) {
  const restaurant = await requireIntegrationAuth(req);
  if (!restaurant) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  await revokeIntegrationSessions(restaurant.id);
  await recordIntegrationAudit(restaurant.id, "sessions.revoked", { actor: "restaurant" });

  return Response.json({ ok: true, revoked: true });
}