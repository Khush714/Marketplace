import { NextRequest } from "next/server";
import {
  listMerchantOrders,
  MERCHANT_FULFILMENTS,
  MERCHANT_ORDER_STATUSES,
  transitionMerchantOrder,
  updateMerchantOrderFulfilment,
  type MerchantFulfilment,
  type MerchantOrderStatus,
} from "@/db/merchant-orders";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";

export const dynamic = "force-dynamic";
const isStatus = (value: unknown): value is MerchantOrderStatus =>
  typeof value === "string" && (MERCHANT_ORDER_STATUSES as readonly string[]).includes(value);

function errorResponse(reason: string) {
  if (reason === "NOT_FOUND") return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  if (reason === "CONFLICT") return Response.json({ ok: false, error: "This order changed on another device. Refresh and try again.", code: "ORDER_STATUS_CONFLICT" }, { status: 409 });
  if (reason === "INVALID_TRANSITION") return Response.json({ ok: false, error: "That order status transition is not allowed.", code: "INVALID_TRANSITION" }, { status: 409 });
  return Response.json({ ok: false, error: "Check the order status, preparation time, and reason." }, { status: 400 });
}

function fulfilmentErrorResponse(reason: string) {
  if (reason === "NOT_FOUND") return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  if (reason === "CONFLICT") return Response.json({ ok: false, error: "This order changed on another device. Refresh and try again.", code: "ORDER_STATUS_CONFLICT" }, { status: 409 });
  if (reason === "INVALID_TRANSITION") return Response.json({ ok: false, error: "This order is closed and its fulfilment can no longer be changed.", code: "ORDER_CLOSED" }, { status: 409 });
  if (reason === "FULFILMENT_DISABLED") return Response.json({ ok: false, error: "That fulfilment option is turned off in your business settings.", code: "FULFILMENT_DISABLED" }, { status: 409 });
  if (reason === "ADDRESS_REQUIRED") return Response.json({ ok: false, error: "Add a delivery address before switching to delivery.", code: "ADDRESS_REQUIRED" }, { status: 400 });
  return Response.json({ ok: false, error: "Check the fulfilment option and delivery address." }, { status: 400 });
}

/** Server-to-server order inbox. Tenant identity is resolved from the business-scoped bearer token. */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
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
  const result = await listMerchantOrders(auth.restaurantId, { status: rawStatus, page, limit, ...(search ? { search } : {}), ...(from ? { from } : {}), ...(toExclusive ? { toExclusive } : {}) });
  if (!result) return Response.json({ ok: false, error: "Merchant not found" }, { status: 404 });
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
  const record = body as Record<string, unknown>;
  const orderCode = typeof record.orderCode === "string" ? record.orderCode.trim() : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(orderCode)) {
    return Response.json({ ok: false, error: "Invalid order reference" }, { status: 400 });
  }

  // Fulfilment-only update: the merchant is changing pickup ↔ delivery, not
  // advancing the status. Status changes keep using the transition path below.
  if (record.fulfilment !== undefined) {
    if (typeof record.fulfilment !== "string" || !(MERCHANT_FULFILMENTS as readonly string[]).includes(record.fulfilment)) {
      return Response.json({ ok: false, error: "Choose pickup or delivery" }, { status: 400 });
    }
    const addressText = typeof record.addressText === "string" ? record.addressText.trim().slice(0, 500) : "";
    const result = await updateMerchantOrderFulfilment({
      restaurantId: auth.restaurantId,
      orderCode,
      fulfilment: record.fulfilment as MerchantFulfilment,
      ...(addressText ? { addressText } : {}),
    });
    if (!result.ok) return fulfilmentErrorResponse(result.reason);
    return Response.json({ ok: true, order: result.order }, { headers: { "Cache-Control": "no-store" } });
  }

  const expectedStatus = record.expectedStatus;
  const nextStatus = record.nextStatus;
  const prepMinutes = record.prepMinutes === undefined ? undefined : Number(record.prepMinutes);
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 250) : "";
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(orderCode) || !isStatus(expectedStatus) || !isStatus(nextStatus)) {
    return Response.json({ ok: false, error: "Invalid order transition request" }, { status: 400 });
  }
  const result = await transitionMerchantOrder({
    restaurantId: auth.restaurantId, orderCode, expectedStatus, nextStatus,
    ...(prepMinutes === undefined ? {} : { prepMinutes }), ...(reason ? { reason } : {}),
  });
  if (!result.ok) return errorResponse(result.reason);
  return Response.json({ ok: true, order: result.order }, { headers: { "Cache-Control": "no-store" } });
}
