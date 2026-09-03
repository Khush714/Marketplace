import { db } from "@/db";
import { notifications } from "@/db/schema";
import { desc, eq, or, isNull } from "drizzle-orm";
import { getCurrentCustomer } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });

  const rows = await db
    .select()
    .from(notifications)
    .where(
      or(
        eq(notifications.customerId, me.id),
        isNull(notifications.customerId), // broadcast/system
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(30);

  return Response.json({
    notifications: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      message: n.message,
      channel: n.channel,
      status: n.status,
      at: n.createdAt.toISOString(),
    })),
  });
}
