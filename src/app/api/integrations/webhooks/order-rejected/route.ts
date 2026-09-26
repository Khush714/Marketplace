import { NextRequest } from "next/server";
import { handlePosOrderStatusWebhook } from "@/lib/pos-order-status-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/integrations/webhooks/order-rejected (POS order.rejected — REJECTED). */
export async function POST(req: NextRequest) {
  return handlePosOrderStatusWebhook(req);
}