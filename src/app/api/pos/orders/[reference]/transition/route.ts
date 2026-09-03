import { db } from "@/db";
import { orders } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { restaurantForPosKey } from "@/lib/pos";
import { transitionOrder } from "@/lib/order-actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/pos/orders/:reference/transition?key=<posKey>&to=accepted
 * The restaurant's POS advances the marketplace order through its lifecycle.
 * The customer app immediately reflects the new state (single source of truth).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? request.headers.get("x-pos-key") ?? "";
  const toStatus = url.searchParams.get("to") ?? "";
  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note : "";

  const restaurantId = await restaurantForPosKey(key);
  if (!restaurantId) {
    return Response.json({ error: "Invalid POS key" }, { status: 401 });
  }

  // Confirm the order belongs to this restaurant's tenant.
  const [owned] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(eq(orders.reference, reference.toUpperCase()), eq(orders.restaurantId, restaurantId)),
    )
    .limit(1);
  if (!owned) {
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  if (!["accepted", "preparing", "ready", "completed", "cancelled"].includes(toStatus)) {
    return Response.json({ error: "Invalid target status" }, { status: 400 });
  }

  const result = await transitionOrder(reference.toUpperCase(), toStatus, {
    actor: "pos",
    note,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, order: result.order });
}
