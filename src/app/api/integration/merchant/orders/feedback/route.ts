import { NextRequest } from "next/server";
import { replyToOrderFeedback } from "@/db/order-feedback";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import { parseReplyInput } from "@/lib/order-feedback";

export const dynamic = "force-dynamic";

/**
 * Merchant App reply endpoint. The restaurant id comes only from the paired
 * business token, so a business can never answer another restaurant's review
 * even if it knows the order code.
 */
export async function PATCH(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const orderCode = typeof record.orderCode === "string" ? record.orderCode.trim() : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(orderCode)) {
    return Response.json({ ok: false, error: "Invalid order reference" }, { status: 400 });
  }
  const response = parseReplyInput(record);
  if (!response) {
    return Response.json({ ok: false, error: "Write a reply before sending it." }, { status: 400 });
  }

  const result = await replyToOrderFeedback({
    restaurantId: auth.restaurantId,
    orderCode,
    response,
  });
  if (result.kind === "NOT_FOUND") {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }
  if (result.kind === "NO_FEEDBACK") {
    return Response.json({ ok: false, error: "This order has no customer feedback yet." }, { status: 409 });
  }
  if (result.kind === "CONFLICT") {
    return Response.json(
      { ok: false, error: "This review was answered on another device. Refresh and try again." },
      { status: 409 },
    );
  }
  return Response.json(
    {
      ok: true,
      alreadyReplied: result.kind === "ALREADY_REPLIED",
      feedback: result.feedback,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
