import { NextRequest } from "next/server";
import { listMerchantOrders, MERCHANT_ORDER_STATUSES, transitionMerchantOrder, type MerchantOrderStatus } from "@/db/merchant-orders";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { requirePartnerSession } from "@/lib/security/restaurant-session";

export const dynamic = "force-dynamic";
const isStatus = (value: unknown): value is MerchantOrderStatus =>
  typeof value === "string" && (MERCHANT_ORDER_STATUSES as readonly string[]).includes(value);

function errorResponse(reason: string) {
  if (reason === "NOT_FOUND") return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  if (reason === "CONFLICT") return Response.json({ ok: false, error: "This order changed on another device. Refresh and try again.", code: "ORDER_STATUS_CONFLICT" }, { status: 409 });
  if (reason === "INVALID_TRANSITION") return Response.json({ ok: false, error: "That order status transition is not allowed.", code: "INVALID_TRANSITION" }, { status: 409 });
  return Response.json({ ok: false, error: "Check the order status, preparation time, and rejection reason." }, { status: 400 });
}

/** GET /api/partner/orders — canonical Marketplace orders for the signed-in merchant. */
export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "orderLookup");
  if (blocked) return blocked;
  const auth = await requirePartnerSession(req, { mutating: false });
  if (!auth.ok) return auth.response;
  const params = req.nextUrl.searchParams;
  const rawStatus = params.get("status") ?? "active";
  if (!(rawStatus === "active" || rawStatus === "all" || rawStatus === "cancelled" || isStatus(rawStatus))) {
    return Response.json({ ok: false, error: "Invalid status filter" }, { status: 400 });
  }
  const page = Math.min(1000, Math.max(1, Number(params.get("page")) || 1));
  const limit = Math.min(50, Math.max(1, Number(params.get("limit")) || 20));
  const search = (params.get("search") ?? "").trim().slice(0, 64);
  const fromText = params.get("from") ?? "", toText = params.get("to") ?? "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromText) ? new Date(`${fromText}T00:00:00+05:30`) : undefined;
  const toExclusive = /^\d{4}-\d{2}-\d{2}$/.test(toText) ? new Date(new Date(`${toText}T00:00:00+05:30`).getTime() + 86_400_000) : undefined;
  const result = await listMerchantOrders(auth.session.restaurantId, { status: rawStatus, page, limit, ...(search ? { search } : {}), ...(from ? { from } : {}), ...(toExclusive ? { toExclusive } : {}) });
  if (!result) return Response.json({ ok: false, error: "Merchant not found" }, { status: 404 });
  return Response.json({ ok: true, ...result });
}

/** PATCH /api/partner/orders — compare-and-set a merchant status transition. */
export async function PATCH(req: NextRequest) {
  const blocked = await guardWrite(req, "partnerOrderWrite");
  if (blocked) return blocked;
  const auth = await requirePartnerSession(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown>;
  const orderCode = typeof body.orderCode === "string" ? body.orderCode.trim() : "";
  const expectedStatus = body.expectedStatus;
  const nextStatus = body.nextStatus;
  const prepMinutes = body.prepMinutes === undefined ? undefined : Number(body.prepMinutes);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 250) : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(orderCode) || !isStatus(expectedStatus) || !isStatus(nextStatus)) {
    return Response.json({ ok: false, error: "Invalid order transition request" }, { status: 400 });
  }
  const result = await transitionMerchantOrder({
    restaurantId: auth.session.restaurantId,
    orderCode,
    expectedStatus,
    nextStatus,
    ...(prepMinutes === undefined ? {} : { prepMinutes }),
    ...(reason ? { reason } : {}),
  });
  if (!result.ok) return errorResponse(result.reason);
  return Response.json({ ok: true, order: result.order });
}
