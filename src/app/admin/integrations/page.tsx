import { requireAdmin } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/db";
import { restaurants, restaurantIntegrations, orders, webhookEvents } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { IntegrationDashboard } from "@/components/admin/IntegrationDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations" };

/**
 * PHASE 15 — Integration Dashboard.
 *
 * Server component with auth guard + direct DB query (self-fetch from a
 * server component doesn't forward cookies, so we query directly).
 */
export default async function AdminIntegrationsPage() {
  if (!(await requireAdmin())) redirect("/admin/login");

  // 1. All restaurants with their integration.
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

  // 2. Webhook failure counts per restaurant.
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

  // 4. Last order per restaurant.
  const lastOrders = await db.execute<{ restaurant_id: number; reference: string }>(
    sql`SELECT DISTINCT ON (${orders.restaurantId}) ${orders.restaurantId} AS restaurant_id, ${orders.reference} AS reference
        FROM ${orders}
        ORDER BY ${orders.restaurantId}, ${orders.id} DESC`,
  );
  const lastOrderMap = new Map<number, string>();
  for (const lo of lastOrders.rows) {
    lastOrderMap.set(lo.restaurant_id, lo.reference);
  }

  // 5. Assemble.
  const integrations = rows.map((r) => ({
    restaurantId: r.restaurantId,
    restaurantName: r.restaurantName,
    restaurantSlug: r.restaurantSlug,
    integrationId: r.integrationId,
    provider: r.provider ?? "manual",
    status: r.status ?? "disconnected",
    healthStatus: r.healthStatus ?? "unknown",
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
    connectedAt: r.connectedAt?.toISOString() ?? null,
    lastError: r.lastError ?? "",
    hasApiKey: r.hasApiKey,
    apiKeyPrefix: r.apiKeyPrefix ?? "",
    webhookFailureCount: failureMap.get(r.restaurantId) ?? 0,
    totalOrders: orderCountMap.get(r.restaurantId) ?? 0,
    lastOrderReference: lastOrderMap.get(r.restaurantId) ?? null,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Phase 15
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">
          Integration Dashboard
        </h1>
        <p className="mt-1 text-white/45">
          Monitor POS connections, webhook health, and sync status across all
          restaurants at a glance.
        </p>
      </div>

      <IntegrationDashboard integrations={integrations} />
    </main>
  );
}
