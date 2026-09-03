import { db } from "@/db";
import { customerAddresses, savedRestaurants, orders } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getCurrentCustomer } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ authenticated: false }, { status: 200 });

  const [addresses, saved, orderCount] = await Promise.all([
    db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, me.id))
      .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.createdAt)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(savedRestaurants)
      .where(eq(savedRestaurants.customerId, me.id)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.customerId, me.id)),
  ]);

  return Response.json({
    authenticated: true,
    customer: me,
    addresses,
    savedCount: Number(saved[0]?.n ?? 0),
    orderCount: Number(orderCount[0]?.n ?? 0),
  });
}
