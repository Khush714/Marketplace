import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/db";
import { restaurants, restaurantIntegrations, orders, webhookEvents } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/integrations
 *
 * PHASE 15 — integration dashboard data. Returns every restaurant with its
 * integration status, health metrics, and computed webhook failure counts.
 * Used by the admin integration dashboard page.
 */

type IntegrationRow = {
  restaurantId: number;
  restaurantName: string;
  restaurantSlug: string;
  integrationId: number | null;
  provider: string;
  status: string;
  healthStatus: string;
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  connectedAt: Date | null;
  lastError: string;
  hasApiKey: boolean;
  apiKeyPrefix: string;
  webhookFailureCount: number;
  totalOrders: number;
  lastOrderReference: string | null;
};

export async function GET(): Promise<Response> {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. All restaurants with their integration (left join — restaurants without
  //    an integration row still appear as "Not Connected").
  const rows = await db
    .select({
      restaurantId: restaurants.id,
      restaurantName: restaurants.name,
      restaurantSlug: restaurants.slug,
      integrationId: restaurantIntegrations.id,
      provider: restaurantIntegrations.provider,
      status: restaurantIntegrations.status,
      healthStatus: restaurantIntegrations.healthStatus,
      lastSyncAt: restaurantIntegrations.lastSyncAt,
      lastSuccessAt: restaurantIntegrations.lastSuccessAt,
      connectedAt: restaurantIntegrations.connectedAt,
      lastError: restaurantIntegrations.lastError,
      hasApiKey: sql<boolean>`LENGTH(${restaurantIntegrations.apiKeyHash}) > 0`,
      apiKeyPrefix: restaurantIntegrations.apiKeyPrefix,
    })
    .from(restaurants)
    .leftJoin(
      restaurantIntegrations,
      eq(restaurantIntegrations.restaurantId, restaurants.id),
    )
    .orderBy(desc(restaurants.name));

  // 2. Webhook failure counts per restaurant (status = 'failed' in webhook_events).
  const failureCounts = await db
    .select({
      restaurantId: webhookEvents.restaurantId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(webhookEvents)
    .where(eq(webhookEvents.status, "failed"))
    .groupBy(webhookEvents.restaurantId);

  const failureMap = new Map(failureCounts.map((r) => [r.restaurantId, r.count]));

  // 3. Order counts per restaurant.
  const orderCounts = await db
    .select({
      restaurantId: orders.restaurantId,
      totalOrders: sql<number>`COUNT(*)::int`,
    })
    .from(orders)
    .groupBy(orders.restaurantId);

  const orderCountMap = new Map(orderCounts.map((r) => [r.restaurantId, r.totalOrders]));

  // 4. Last order per restaurant (most recent order per restaurant).
  const lastOrders = await db.execute<{
    restaurant_id: number;
    reference: string;
  }>(
    sql`SELECT DISTINCT ON (${orders.restaurantId}) ${orders.restaurantId} AS restaurant_id, ${orders.reference} AS reference
        FROM ${orders}
        ORDER BY ${orders.restaurantId}, ${orders.id} DESC`,
  );

  const lastOrderMap = new Map<number, string>();
  for (const lo of lastOrders.rows) {
    lastOrderMap.set(lo.restaurant_id, lo.reference);
  }

  // 5. Assemble.
  const result: IntegrationRow[] = rows.map((r) => ({
    restaurantId: r.restaurantId,
    restaurantName: r.restaurantName,
    restaurantSlug: r.restaurantSlug,
    integrationId: r.integrationId,
    provider: r.provider ?? "manual",
    status: r.status ?? "disconnected",
    healthStatus: r.healthStatus ?? "unknown",
    lastSyncAt: r.lastSyncAt,
    lastSuccessAt: r.lastSuccessAt,
    connectedAt: r.connectedAt,
    lastError: r.lastError ?? "",
    hasApiKey: r.hasApiKey,
    apiKeyPrefix: r.apiKeyPrefix ?? "",
    webhookFailureCount: failureMap.get(r.restaurantId) ?? 0,
    totalOrders: orderCountMap.get(r.restaurantId) ?? 0,
    lastOrderReference: lastOrderMap.get(r.restaurantId) ?? null,
  }));

  return Response.json({ integrations: result });
}
