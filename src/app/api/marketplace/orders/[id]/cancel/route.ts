import { transitionOrder } from "@/lib/order-actions";
import { getCurrentCustomer } from "@/lib/session";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  marketplaceOrderingEnabled,
  ORDERING_DISABLED_MESSAGE,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

/**
 * POST /api/marketplace/orders/:id/cancel
 * Customer-initiated cancellation, allowed only while the order is `accepted`
 * (PHASE 9 contract: ACCEPTED → CANCELLED). While a order is still `placed`
 * the restaurant either accepts it or rejects it — there is no customer-cancel
 * edge before acceptance. PRESERVED (Phase 20); gated by
 * MARKETPLACE_ORDERING_ENABLED.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!marketplaceOrderingEnabled) {
    return Response.json({ error: ORDERING_DISABLED_MESSAGE }, { status: 410 });
  }

  const { id } = await params;
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });

  const [order] = await db
    .select({
      reference: orders.reference,
      customerId: orders.customerId,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.reference, id.toUpperCase()))
    .limit(1);
  if (!order) return Response.json({ error: "Order not found" }, { status: 404 });

  if (order.customerId && order.customerId !== me.id) {
    return Response.json(
      { error: "You can only cancel your own orders" },
      { status: 403 },
    );
  }
  if (order.status !== "accepted") {
    return Response.json(
      {
        error:
          "This order can only be cancelled after the restaurant accepts it.",
      },
      { status: 409 },
    );
  }

  const result = await transitionOrder(order.reference, "cancelled", {
    actor: "customer",
    note: "Cancelled by customer",
  });
  if (!result.ok)
    return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, order: result.order });
}
