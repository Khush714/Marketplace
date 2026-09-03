import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, orderItems, restaurants } from "@/db/schema";
import { restaurantForPosKey } from "@/lib/pos";
import { num } from "@/lib/format";
import { legacyToCanonical } from "@/lib/order-lifecycle";

/** Alias every legacy string onto the canonical lifecycle for filtering. */
const CANONICAL_ALIASES: Record<string, string[]> = {
  placed: ["placed", "pending"],
  accepted: ["accepted", "confirmed"],
  preparing: ["preparing"],
  ready: ["ready"],
  completed: ["completed", "delivered", "out_for_delivery"],
  cancelled: ["cancelled"],
};

export const dynamic = "force-dynamic";

/**
 * GET /api/pos/orders?key=<posKey>&status=placed
 * POS bridge — the restaurant's existing system polls this to see new
 * marketplace orders without re-keying anything.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? request.headers.get("x-pos-key") ?? "";
  const restaurantId = await restaurantForPosKey(key);
  if (!restaurantId) {
    return Response.json({ error: "Invalid POS key" }, { status: 401 });
  }

  const statusFilter = url.searchParams.get("status");
  const where = statusFilter
    ? and(
        eq(orders.restaurantId, restaurantId),
        inArray(orders.status, CANONICAL_ALIASES[statusFilter] ?? [statusFilter]),
      )
    : eq(orders.restaurantId, restaurantId);

  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      fulfillmentType: orders.fulfillmentType,
      paymentMethod: orders.paymentMethod,
      paymentStatus: orders.paymentStatus,
      subtotal: orders.subtotal,
      taxAmount: orders.taxAmount,
      discountAmount: orders.discountAmount,
      deliveryFee: orders.deliveryFee,
      total: orders.total,
      customerName: orders.customerName,
      customerAddress: orders.customerAddress,
      notes: orders.notes,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(60);

  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select()
        .from(orderItems)
        .where(inArray(orderItems.orderId, ids))
    : [];

  const itemsByOrder = new Map<number, typeof items>();
  for (const i of items) {
    const list = itemsByOrder.get(i.orderId) ?? [];
    list.push(i);
    itemsByOrder.set(i.orderId, list);
  }

  return Response.json({
    restaurantId,
    orders: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: legacyToCanonical(r.status),
      rawStatus: r.status,
      fulfillment: r.fulfillmentType,
      payment: { method: r.paymentMethod, status: r.paymentStatus },
      totals: {
        subtotal: num(r.subtotal),
        tax: num(r.taxAmount),
        discount: num(r.discountAmount),
        deliveryFee: num(r.deliveryFee),
        total: num(r.total),
      },
      customer: { name: r.customerName, address: r.customerAddress },
      notes: r.notes,
      placedAt: r.createdAt.toISOString(),
      items: (itemsByOrder.get(r.id) ?? []).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: num(i.unitPrice),
        modifiers: safeParse(i.modifiers),
      })),
    })),
  });
}

function safeParse(json: string): unknown[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
