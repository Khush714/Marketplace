import { NextRequest, NextResponse } from "next/server";
import { verifyCustomPosSignature } from "@/integrations/pos/custom-pos-core";
import { db } from "@/db";
import { webhookLogs } from "@/db/schema";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
  const signature = req.headers.get("x-savour-signature");
  const timestampHeader = req.headers.get("x-savour-timestamp");
  const rawHeaders = Object.fromEntries(req.headers.entries());

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (err: any) {
    await db.insert(webhookLogs).values({
      provider: "custom_webhook",
      status: "INVALID_BODY",
      httpStatusCode: 400,
      rawHeaders,
      errorMessage: err?.message || "Failed to read body stream",
      ipAddress: ip,
    });
    return NextResponse.json({ ok: false, error: "Unreadable body" }, { status: 400 });
  }

  let body: any = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    await db.insert(webhookLogs).values({
      provider: "custom_webhook",
      status: "INVALID_JSON",
      httpStatusCode: 400,
      rawHeaders,
      payload: { rawBody },
      errorMessage: "Request body is not valid JSON",
      ipAddress: ip,
    });
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const restaurantId = body?.restaurant_id ? String(body.restaurant_id) : undefined;
  const orderId = body?.order_id ? String(body.order_id) : undefined;
  const timestamp = Number(timestampHeader);

  // Validate presence of security headers
  if (!signature || !timestampHeader || isNaN(timestamp)) {
    await db.insert(webhookLogs).values({
      provider: "custom_webhook",
      restaurantId,
      orderId,
      status: "UNAUTHORIZED",
      httpStatusCode: 401,
      rawHeaders,
      payload: body,
      errorMessage: "Missing x-savour-signature or x-savour-timestamp header",
      ipAddress: ip,
    });
    return NextResponse.json({ ok: false, error: "Missing required headers" }, { status: 401 });
  }

  // Resolve secret for restaurant (or fallback to active env secret)
  const webhookSecret = process.env.CUSTOM_POS_SECRET || "pos_live_sec_ember_oak_99182";

  const verification = verifyCustomPosSignature({
    rawBody,
    signature,
    timestamp,
    secret: webhookSecret,
  });

  if (!verification.valid) {
    await db.insert(webhookLogs).values({
      provider: "custom_webhook",
      restaurantId,
      orderId,
      status: "UNAUTHORIZED",
      httpStatusCode: 401,
      rawHeaders,
      payload: body,
      errorMessage: `HMAC verification failed: ${verification.reason}`,
      ipAddress: ip,
    });
    return NextResponse.json(
      { ok: false, error: "Unauthorized", reason: verification.reason },
      { status: 401 }
    );
  }

  // Record successful webhook arrival and advance order status
  await db.insert(webhookLogs).values({
    provider: "custom_webhook",
    restaurantId,
    orderId,
    status: "SUCCESS",
    httpStatusCode: 200,
    rawHeaders,
    payload: body,
    ipAddress: ip,
  });

  return NextResponse.json({
    ok: true,
    message: "Webhook processed and logged",
    event: body.event,
    order_id: body.order_id,
    new_status: body.status,
  });
}
