import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { restaurantIntegrations, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseConfig } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/pos — POS-side connection authorization.
 *
 * This is the other half of the "Connect RestaurantAI" flow. The marketplace
 * generates a short-lived connection code (MKT-XXXX-XXXX) and shows it to the
 * admin; the restaurant's POS enters/presents that code together with the
 * restaurant's marketplace id to authorize. On success the integration record
 * settles into `connected`, which the marketplace admin UI detects on its next
 * poll.
 *
 * Phase 1 — Marketplace side only. This endpoint is unauthenticated by design
 * because the POS has no admin session; authenticity is the code itself, which
 * is random, short-lived, and shown only to the restaurant owner.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const marketplaceId =
    typeof body.restaurantId === "string" ? body.restaurantId.trim() : "";
  const code =
    typeof body.connectionCode === "string" ? body.connectionCode.trim() : "";

  if (!marketplaceId || !code) {
    return Response.json(
      { error: "restaurantId and connectionCode are required" },
      { status: 400 },
    );
  }

  // Find the restaurant by its permanent marketplace id (rst_…).
  const [restaurant] = await db
    .select({ id: restaurants.id, marketplaceId: restaurants.marketplaceId })
    .from(restaurants)
    .where(eq(restaurants.marketplaceId, marketplaceId))
    .limit(1);

  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant" }, { status: 404 });
  }

  const [integration] = await db
    .select()
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, restaurant.id))
    .limit(1);

  if (!integration) {
    return Response.json(
      { error: "No integration record for this restaurant" },
      { status: 404 },
    );
  }

  // Already connected — idempotent success; nothing to do.
  if (integration.status === "connected") {
    return Response.json({
      ok: true,
      status: "connected",
      connectedAt: integration.connectedAt,
    });
  }

  // Compare the presented code against the stored one, timing-safely.
  const config = parseConfig(integration.config);
  const stored = typeof config.connectionCode === "string" ? config.connectionCode : "";
  const presented = code.toUpperCase();

  const matches =
    stored.length === presented.length &&
    stored.length > 0 &&
    timingSafeEqual(Buffer.from(stored), Buffer.from(presented));

  if (!matches) {
    return Response.json(
      { error: "Invalid connection code" },
      { status: 401 },
    );
  }

  const now = new Date();
  const nextConfig = { ...config };
  delete nextConfig.connectionCode;
  delete nextConfig.connectionCodeGeneratedAt;
  nextConfig.authorizedAt = now.toISOString();
  nextConfig.authorizedProvider = "restaurantai";

  const [updated] = await db
    .update(restaurantIntegrations)
    .set({
      status: "connected",
      connectedAt: now,
      lastSuccessAt: now,
      lastError: "",
      externalRestaurantId:
        typeof body.externalRestaurantId === "string" &&
        body.externalRestaurantId.trim()
          ? body.externalRestaurantId.trim().slice(0, 80)
          : integration.externalRestaurantId,
      config: JSON.stringify(nextConfig),
      updatedAt: now,
    })
    .where(eq(restaurantIntegrations.restaurantId, restaurant.id))
    .returning();

  return Response.json({
    ok: true,
    status: updated.status,
    provider: updated.provider,
    connectedAt: updated.connectedAt,
    restaurantId: restaurant.marketplaceId,
  });
}