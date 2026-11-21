import { NextRequest } from "next/server";
import { listIntegrationOrders } from "@/db/queries";
import { requireIntegrationAuth } from "../_auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const restaurant = await requireIntegrationAuth(req);
  if (!restaurant) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const orders = await listIntegrationOrders(restaurant.id);
  return Response.json({ ok: true, orders });
}