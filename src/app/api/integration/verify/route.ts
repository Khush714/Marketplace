import { db } from "@/db";
import { restaurantIntegrations, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateIntegrationKey } from "@/lib/integrations";
import { parseConfig } from "@/lib/integrations";
import type { IntegrationVerifyResponse } from "@/lib/integration-contract";

export const dynamic = "force-dynamic";

/**
 * GET /api/integration/verify?key=<posKey|webhookSecret>
 * RestaurantAI identifies itself, learns the marketplace identity it is tied to,
 * and reads the current connection state (status, capabilities, sync health).
 * Same POS-key credential the queue uses; also accepts the webhook secret.
 */
export async function GET(request: Request) {
  const restaurantId = await authenticateIntegrationKey(request);
  if (!restaurantId) {
    return Response.json({ error: "Invalid integration key" }, { status: 401 });
  }

  const [row] = await db
    .select({
      restaurantId: restaurants.id,
      marketplaceId: restaurants.marketplaceId,
      slug: restaurants.slug,
      name: restaurants.name,
      externalRestaurantId: restaurantIntegrations.externalRestaurantId,
      status: restaurantIntegrations.status,
      provider: restaurantIntegrations.provider,
      capabilities: restaurantIntegrations.capabilities,
      connectedAt: restaurantIntegrations.connectedAt,
      lastSyncAt: restaurantIntegrations.lastSyncAt,
      lastSuccessAt: restaurantIntegrations.lastSuccessAt,
      lastError: restaurantIntegrations.lastError,
      healthStatus: restaurantIntegrations.healthStatus,
    })
    .from(restaurants)
    .leftJoin(
      restaurantIntegrations,
      eq(restaurantIntegrations.restaurantId, restaurants.id),
    )
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!row) return Response.json({ error: "Restaurant not found" }, { status: 404 });

  const payload: IntegrationVerifyResponse = {
    ok: true,
    restaurant: {
      marketplaceId: row.marketplaceId,
      slug: row.slug,
      name: row.name,
      externalRestaurantId: row.externalRestaurantId ?? null,
    },
    connection: {
      status: row.status ?? "disconnected",
      provider: row.provider ?? "manual",
      capabilities: parseConfig(row.capabilities ?? "{}"),
      connectedAt: row.connectedAt?.toISOString() ?? null,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    },
  };
  if (row.lastError && (row.healthStatus === "down" || row.status === "error")) {
    (payload.connection as { lastError?: string }).lastError = row.lastError;
  }
  return Response.json(payload);
}