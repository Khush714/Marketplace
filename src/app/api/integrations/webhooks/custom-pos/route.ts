import { NextRequest, NextResponse } from "next/server";
import { 
  CUSTOM_POS_HEADER_SIGNATURE, 
  CUSTOM_POS_HEADER_TIMESTAMP, 
  verifyCustomPosSignature 
} from "@/integrations/pos/custom-pos-core";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const timestamp = req.headers.get(CUSTOM_POS_HEADER_TIMESTAMP);
  const signature = req.headers.get(CUSTOM_POS_HEADER_SIGNATURE);
  const rawBody = await req.text();

  let body: Record<string, any>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { orderId, restaurantId, status } = body;
  if (!orderId || !restaurantId || !status) {
    return NextResponse.json({ ok: false, error: "Missing required fields: orderId, restaurantId, status" }, { status: 400 });
  }

  const secret = process.env.CUSTOM_POS_WEBHOOK_SECRET || "whsec_live_custom_pos";

  const verification = verifyCustomPosSignature({
    rawBody,
    timestamp,
    signature,
    secret,
  });

  if (!verification.valid) {
    return NextResponse.json({ ok: false, error: `Unauthorized: ${verification.reason}` }, { status: 401 });
  }

  const statusMap: Record<string, string> = {
    ACCEPTED: "active",
    IN_KITCHEN: "in_kitchen",
    FOOD_READY: "food_ready",
    OUT_FOR_DELIVERY: "dispatched",
    CANCELLED: "cancelled"
  };

  const targetStatus = statusMap[status.toUpperCase()] || "active";

  return NextResponse.json({
    ok: true,
    orderId,
    status: targetStatus,
    updatedAt: new Date().toISOString()
  });
}
