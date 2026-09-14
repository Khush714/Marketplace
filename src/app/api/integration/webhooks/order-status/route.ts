import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyInboundWebhook } from "@/lib/integrations";
import { transitionOrder } from "@/lib/order-actions";
import type {
  OrderStatusWebhookBody,
  OrderStatusWebhookResponse,
} from "@/lib/integration-contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/webhooks/order-status
 * RestaurantAI reports an order status change it observed on its side. The
 * marketplace validates the transition against the canonical lifecycle (the
 * SAME state machine the POS queue writes) and records the audit event. The
 * signature binds this body to a specific restaurant, and the order must
 * belong to that restaurant — a signed webhook can never touch another
 * tenant's order.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = await verifyInboundWebhook(request, rawBody);
  if (!auth) {
    return Response.json(
      { error: "Missing, stale, or invalid webhook signature" },
      { status: 401 },
    );
  }

  let body: OrderStatusWebhookBody;
  try {
    body = JSON.parse(rawBody) as OrderStatusWebhookBody;
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const reference = (body.orderReference ?? "").trim();
  if (!reference) {
    return Response.json({ error: "orderReference is required" }, { status: 400 });
  }

  const [order] = await db
    .select({ id: orders.id, restaurantId: orders.restaurantId })
    .from(orders)
    .where(eq(orders.reference, reference))
    .limit(1);
  if (!order) {
    const res: OrderStatusWebhookResponse = { ok: false, error: "Order not found" };
    return Response.json(res, { status: 404 });
  }
  if (order.restaurantId !== auth.restaurantId) {
    return Response.json({ error: "Order belongs to another restaurant" }, { status: 403 });
  }

  const result = await transitionOrder(reference, body.status, {
    actor: "pos",
    note: body.note?.trim() || "Updated via RestaurantAI webhook",
  });
  if (!result.ok) {
    const res: OrderStatusWebhookResponse = {
      ok: false,
      error: result.error,
      details: { status: result.status },
    };
    return Response.json(res, { status: result.status });
  }

  const res: OrderStatusWebhookResponse = {
    ok: true,
    order: { reference, status: result.order?.status ?? body.status },
  };
  return Response.json(res);
}