import { db } from "@/db";
import { orders, restaurants } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { num } from "@/lib/format";
import { legacyToCanonical } from "@/lib/order-lifecycle";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const BUCKETS: Record<string, string[]> = {
  live: ["placed", "accepted", "preparing", "ready", "picked_up", "pending", "confirmed"],
  completed: ["completed", "delivered"],
  cancelled: ["cancelled", "rejected"],
};

/** GET /api/admin/orders?bucket=live|completed|cancelled */
export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const bucket = new URL(request.url).searchParams.get("bucket") ?? "live";
  const statuses = BUCKETS[bucket] ?? BUCKETS.live;

  const rows = await db
    .select({
      reference: orders.reference,
      status: orders.status,
      total: orders.total,
      fulfillmentType: orders.fulfillmentType,
      createdAt: orders.createdAt,
      customerName: orders.customerName,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
    })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .where(inArray(orders.status, statuses))
    .orderBy(desc(orders.createdAt))
    .limit(80);

  return Response.json({
    bucket,
    orders: rows.map((r) => ({
      reference: r.reference,
      status: legacyToCanonical(r.status),
      total: num(r.total),
      fulfillment: r.fulfillmentType,
      placedAt: r.createdAt.toISOString(),
      customerName: r.customerName,
      restaurant: { name: r.restaurantName, slug: r.restaurantSlug },
    })),
  });
}
