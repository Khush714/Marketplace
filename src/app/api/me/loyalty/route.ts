import { db } from "@/db";
import { loyaltyLedger } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getCurrentCustomer } from "@/lib/session";
import { pointsEarned, redeemValue } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentCustomer();
  if (!me) return Response.json({ error: "Sign in required" }, { status: 401 });

  const ledger = await db
    .select()
    .from(loyaltyLedger)
    .where(eq(loyaltyLedger.customerId, me.id))
    .orderBy(desc(loyaltyLedger.createdAt))
    .limit(20);

  return Response.json({
    points: me.loyaltyPoints,
    dollarValue: redeemValue(me.loyaltyPoints),
    earnRate: "10 points per $10 spent",
    example: `A $500 order earns ${pointsEarned(500)} Tablz points`,
    ledger: ledger.map((r) => ({
      points: r.points,
      reason: r.reason,
      at: r.createdAt.toISOString(),
    })),
  });
}
