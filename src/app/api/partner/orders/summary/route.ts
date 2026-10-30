import { NextRequest } from "next/server";
import { getPartnerOrderSummary } from "@/db/queries";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: false });
  if (!auth.ok) return auth.response;
  const result = await getPartnerOrderSummary(auth.session.restaurantId);
  return Response.json({ ok: true, ...result });
}
