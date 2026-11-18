import { NextRequest } from "next/server";
import { getMerchantOrderSummary } from "@/db/merchant-orders";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePartnerSession(req, { mutating: false });
  if (!auth.ok) return auth.response;
  const result = await getMerchantOrderSummary(auth.session.restaurantId);
  return Response.json({ ok: true, ...result });
}
