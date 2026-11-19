import { NextRequest } from "next/server";
import { orderFeedbackInbox } from "@/db/order-feedback";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";

/** Restaurant-scoped review inbox plus the 30-day themes drawn from it. */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const inbox = await orderFeedbackInbox(auth.restaurantId);
  return Response.json({ ok: true, ...inbox }, { headers: { "Cache-Control": "no-store" } });
}
