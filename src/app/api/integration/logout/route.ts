import { NextRequest } from "next/server";
import { logoutIntegrationSession, recordIntegrationAudit } from "@/db/queries";
import { parseBearerToken, requireIntegrationAuth } from "../_auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/logout
 *
 *   Authorization: Bearer <integration-session>
 *
 * Ends exactly the session that presented the token — this POS terminal signs
 * out; the restaurant's other sessions stay. The inverse of
 * `/api/integration/revoke`, which is the "sign out everywhere" fire-drill
 * that kills every session for the restaurant at once.
 */
export async function POST(req: NextRequest) {
  const restaurant = await requireIntegrationAuth(req);
  if (!restaurant) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const loggedOut = await logoutIntegrationSession(parseBearerToken(req));
  if (loggedOut) {
    await recordIntegrationAudit(restaurant.id, "session.logged_out", {
      actor: "restaurant",
      ipAddress: req.headers.get("x-forwarded-for"),
    });
  }

  return Response.json({ ok: true, loggedOut });
}