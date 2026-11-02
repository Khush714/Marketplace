import { NextRequest } from "next/server";
import {
  listMerchantOrders,
  toMerchantOrder,
  updateMerchantOrderDelivery,
  updateMerchantOrderDeliveryMode,
  transitionMerchantOrder,
} from "@/db/merchant-integration";
import { handleCancelledOrderPaymentByOrderId } from "@/integrations/payments/refund";
import { guardRead, guardWrite, readJsonBody } from "@/lib/abuse";
import { isMarketplaceOrderStatus } from "@/integrations/pos/order-status";
import {
  isMerchantDeliveryMode,
  isMerchantDeliveryStatus,
} from "@/lib/merchant-delivery-core";
import { requireMerchantIntegration } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDER_FILTERS = new Set([
  "active",
  "all",
  "cancelled",
  "new",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "rejected",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pageParam(raw: string | null, fallback: number, max: number): number {
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}

export async function GET(req: NextRequest) {
  const blocked = guardRead(req, "merchantIntegrationRead");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const params = req.nextUrl.searchParams;
  const requestedStatus = (params.get("status") ?? "active").trim().toLowerCase();
  if (!ORDER_FILTERS.has(requestedStatus)) {
    return Response.json({ ok: false, error: "Invalid order status filter." }, { status: 400 });
  }
  const page = pageParam(params.get("page"), 1, 1000);
  const limit = pageParam(params.get("limit"), 20, 50);
  const search = (params.get("search") ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20);
  const result = await listMerchantOrders(auth.session.restaurant.id, {
    status: requestedStatus,
    search,
    from: params.get("from"),
    to: params.get("to"),
    page,
    limit,
  });
  return Response.json(
    {
      ok: true,
      orders: result.rows.map((row) => toMerchantOrder(row, auth.session.merchantBusinessId)),
      hasMore: result.hasMore,
      page,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(req: NextRequest) {
  const blocked = await guardWrite(req, "merchantIntegrationWrite");
  if (blocked) return blocked;
  const auth = await requireMerchantIntegration(req);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = record(parsed.body);
  if (!body) {
    return Response.json({ ok: false, error: "Invalid order update." }, { status: 400 });
  }

  const orderCode =
    typeof body.orderCode === "string"
      ? body.orderCode.trim()
      : typeof body.id === "string"
        ? body.id.trim()
        : "";
  if ("delivery" in body) {
    const delivery = record(body.delivery);
    const courierName =
      typeof delivery?.courierName === "string" ? delivery.courierName.trim() : undefined;
    if (
      !delivery ||
      "deliveryMode" in body ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(orderCode) ||
      !isMerchantDeliveryStatus(delivery.status) ||
      (delivery.courierName !== undefined &&
        (typeof delivery.courierName !== "string" ||
          !courierName ||
          courierName.length > 80 ||
          /[\u0000-\u001f\u007f]/.test(courierName)))
    ) {
      return Response.json({ ok: false, error: "Invalid delivery update." }, { status: 400 });
    }
    const result = await updateMerchantOrderDelivery({
      restaurantId: auth.session.restaurant.id,
      businessId: auth.session.merchantBusinessId,
      orderCode,
      status: delivery.status,
      courierName,
    });
    if (result.kind === "not_found") {
      return Response.json({ ok: false, error: "Order not found." }, { status: 404 });
    }
    if (result.kind === "delivery_mode_required") {
      return Response.json({ ok: false, error: "Choose a delivery method first." }, { status: 409 });
    }
    if (result.kind === "courier_required") {
      return Response.json({ ok: false, error: "Add the courier name before assigning delivery." }, { status: 400 });
    }
    if (result.kind === "not_ready") {
      return Response.json({ ok: false, error: "The order is not ready for this delivery update." }, { status: 409 });
    }
    if (result.kind === "invalid_transition" || result.kind === "conflict") {
      return Response.json({ ok: false, error: "This delivery update is no longer valid. Refresh the order." }, { status: 409 });
    }
    return Response.json(
      { ok: true, order: toMerchantOrder(result.order, auth.session.merchantBusinessId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if ("deliveryMode" in body) {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(orderCode) ||
      (body.deliveryMode !== null && !isMerchantDeliveryMode(body.deliveryMode))
    ) {
      return Response.json({ ok: false, error: "Invalid delivery method." }, { status: 400 });
    }
    const result = await updateMerchantOrderDeliveryMode({
      restaurantId: auth.session.restaurant.id,
      orderCode,
      deliveryMode: body.deliveryMode,
    });
    if (result.kind === "not_found") {
      return Response.json({ ok: false, error: "Order not found." }, { status: 404 });
    }
    if (result.kind === "not_editable" || result.kind === "conflict") {
      return Response.json({ ok: false, error: "This order can no longer be changed." }, { status: 409 });
    }
    return Response.json(
      { ok: true, order: toMerchantOrder(result.order, auth.session.merchantBusinessId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const expectedStatus = typeof body.expectedStatus === "string" ? body.expectedStatus : "";
  const nextStatus = typeof body.nextStatus === "string" ? body.nextStatus : "";
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(orderCode) ||
    !isMarketplaceOrderStatus(expectedStatus) ||
    !isMarketplaceOrderStatus(nextStatus)
  ) {
    return Response.json({ ok: false, error: "Invalid order transition." }, { status: 400 });
  }

  let prepMinutes: number | undefined;
  if (nextStatus === "ACCEPTED") {
    if (
      typeof body.prepMinutes !== "number" ||
      !Number.isInteger(body.prepMinutes) ||
      body.prepMinutes < 5 ||
      body.prepMinutes > 180
    ) {
      return Response.json(
        { ok: false, error: "Choose a preparation time between 5 and 180 minutes." },
        { status: 400 },
      );
    }
    prepMinutes = body.prepMinutes;
  }

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 250) : "";
  if (nextStatus === "REJECTED" && !reason) {
    return Response.json(
      { ok: false, error: "Please provide a reason for rejecting this order." },
      { status: 400 },
    );
  }

  const result = await transitionMerchantOrder({
    restaurantId: auth.session.restaurant.id,
    businessId: auth.session.merchantBusinessId,
    orderCode,
    expectedStatus,
    nextStatus,
    prepMinutes,
    reason,
  });
  if (result.kind === "not_found") {
    return Response.json({ ok: false, error: "Order not found." }, { status: 404 });
  }
  if (result.kind === "conflict") {
    return Response.json(
      { ok: false, error: "This order changed on another device. Refresh the latest status.", currentStatus: result.currentStatus },
      { status: 409 },
    );
  }
  if (result.kind === "payment_not_cleared") {
    return Response.json(
      { ok: false, error: "This order cannot be accepted until its payment is confirmed." },
      { status: 409 },
    );
  }
  if (result.kind === "delivery_mode_required") {
    return Response.json(
      { ok: false, error: "Choose a delivery method before confirming delivery." },
      { status: 409 },
    );
  }
  if (result.kind === "delivery_not_complete") {
    return Response.json(
      { ok: false, error: "Mark delivery complete before closing the order." },
      { status: 409 },
    );
  }
  if (result.kind === "invalid_transition") {
    return Response.json({ ok: false, error: "Invalid order transition." }, { status: 409 });
  }

  if (result.kind === "updated" && nextStatus === "REJECTED") {
    void handleCancelledOrderPaymentByOrderId(result.order.id, "ORDER_REJECTED").catch((error) => {
      console.error("[merchant-integration] rejection refund orchestration failed", error);
    });
  }

  return Response.json(
    {
      ok: true,
      order: toMerchantOrder(result.order, auth.session.merchantBusinessId),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
