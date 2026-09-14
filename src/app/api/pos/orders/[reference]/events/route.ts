import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { restaurantForPosKey } from "@/lib/pos";
import { listOrderEvents } from "@/lib/order-events";
import { legacyToCanonical } from "@/lib/order-lifecycle";

export const dynamic = "force-dynamic";

/**
 * GET /api/pos/orders/:reference/events?key=<posKey>
 * PHASE 10 — the restaurant's integration debugging surface: the complete
 * append-only audit trail for one order (order_placed → payment_* →
 * sent-to-restaurant → lifecycle → rider leg), oldest first. Same event list
 * the customer page renders, so the two sides can never disagree.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? request.headers.get("x-pos-key") ?? "";

  const restaurantId = await restaurantForPosKey(key);
  if (!restaurantId) {
    return Response.json({ error: "Invalid POS key" }, { status: 401 });
  }

  const [owned] = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.reference, reference.toUpperCase()),
        eq(orders.restaurantId, restaurantId),
      ),
    )
    .limit(1);
  if (!owned) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  const events = await listOrderEvents(owned.id);
  return Response.json({
    order: {
      reference: owned.reference,
      status: legacyToCanonical(owned.status),
    },
    events,
  });
}