import { NextRequest } from "next/server";
import { handleCustomPosWebhook } from "@/lib/custom-pos-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/integrations/webhooks/custom-pos (custom POS order status callback). */
export async function POST(req: NextRequest) {
  return handleCustomPosWebhook(req);
}
