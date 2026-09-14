import { getIntegrationMenu } from "@/lib/integration-menu";
import { authenticateIntegrationKey } from "@/lib/integrations";
import { db } from "@/db";
import { restaurantIntegrations } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/menu?key=<posKey|webhookSecret>
 * RestaurantAI pulls the full marketplace menu snapshot, including
 * unavailable items and every external/marketplace id it needs to sync back.
 * Marks the pull time on the integration record for sync-health bookkeeping.
 */
export async function GET(request: Request) {
  const restaurantId = await authenticateIntegrationKey(request);
  if (!restaurantId) {
    return Response.json({ error: "Invalid integration key" }, { status: 401 });
  }

  const menu = await getIntegrationMenu(restaurantId);
  if (!menu) {
    return Response.json({ error: "Restaurant not found" }, { status: 404 });
  }

  const now = new Date();
  await db
    .update(restaurantIntegrations)
    .set({ lastSyncAt: now, lastSuccessAt: now, healthStatus: "healthy" })
    .where(eq(restaurantIntegrations.restaurantId, restaurantId));

  return Response.json(menu);
}