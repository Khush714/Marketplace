import { db } from "@/db";
import { notifications, orders } from "@/db/schema";
import { desc, eq, or, isNull } from "drizzle-orm";
import { getCurrentCustomer } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });

  const rows = await db
    .select({ n: notifications, order: orders })
    .from(notifications)
    .leftJoin(orders, eq(notifications.orderId, orders.id))
    .where(
      or(
        eq(notifications.customerId, me.id),
        isNull(notifications.customerId), // broadcast/system
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(30);

  return Response.json({
    notifications: rows.map(({ n, order }) => ({
      id: n.id,
      kind: n.kind,
      message: n.message,
      channel: n.channel,
      status: n.status,
      at: n.createdAt.toISOString(),
      orderId: n.orderId,
      // PHASE 22 — the reference powers the "View Order" CTA → /orders/[reference]
      // on the customer notifications screen, closing the loop: notification →
      // tracking page → live status.
      reference: order?.reference ?? null,
    })),
  });
}