import { NextRequest } from "next/server";
import { handlePetpoojaWebhook } from "@/lib/petpooja-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/integrations/webhooks/petpooja (Petpooja order status callback). */
export async function POST(req: NextRequest) {
  return handlePetpoojaWebhook(req);
}
