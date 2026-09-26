import { NextRequest } from "next/server";
import { handlePosOrderStatusWebhook } from "@/lib/pos-order-status-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/integrations/webhooks/order-cancelled (POS order.cancelled — CANCELLED). */
export async function POST(req: NextRequest) {
  return handlePosOrderStatusWebhook(req);
}