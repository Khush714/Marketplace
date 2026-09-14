import { db } from "@/db";
import { restaurantIntegrations, restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-auth";
import { connectionCode } from "@/lib/format";
import { webhookSecret } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/restaurants/[id]/connection/initiate
 *
 * Generates a short-lived connection code and sets the integration status
 * to "connecting". The POS will eventually use this code to authorize
 * the connection. This is the Marketplace side only — no POS handshake.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const restaurantId = Number(id);
  if (!Number.isFinite(restaurantId)) {
    return Response.json({ error: "Invalid restaurant id" }, { status: 400 });
  }

  // Verify restaurant exists
  const [restaurant] = await db
    .select({ id: restaurants.id, name: restaurants.name, marketplaceId: restaurants.marketplaceId })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  if (!restaurant) {
    return Response.json({ error: "Restaurant not found" }, { status: 404 });
  }

  // Find existing integration record
  const [existing] = await db
    .select()
    .from(restaurantIntegrations)
    .where(eq(restaurantIntegrations.restaurantId, restaurantId))
    .limit(1);

  const code = connectionCode();
  const now = new Date();

  if (existing) {
    // If already connected or connecting with a recent code, block
    if (existing.status === "connected") {
      return Response.json(
        { error: "Restaurant is already connected" },
        { status: 409 },
      );
    }

    // Update existing record: set status to connecting, store code in config.
    // A fresh code invalidates any prior authorization.
    const config = existing.config ? JSON.parse(existing.config) : {};
    config.connectionCode = code;
    config.connectionCodeGeneratedAt = now.toISOString();
    delete config.authorizedAt;

    const [updated] = await db
      .update(restaurantIntegrations)
      .set({
        provider: "restaurantai",
        status: "connecting",
        config: JSON.stringify(config),
        // Leaving `connected` clears the connected_at marker.
        connectedAt: null,
        updatedAt: now,
      })
      .where(eq(restaurantIntegrations.restaurantId, restaurantId))
      .returning();

    return Response.json({
      ok: true,
      connection: {
        restaurantId: restaurant.marketplaceId,
        restaurantName: restaurant.name,
        connectionCode: code,
        status: updated.status,
        provider: updated.provider,
      },
    });
  }

  // No record yet — create one
  const config = {
    connectionCode: code,
    connectionCodeGeneratedAt: now.toISOString(),
  };

  const [created] = await db
    .insert(restaurantIntegrations)
    .values({
      restaurantId,
      provider: "restaurantai",
      status: "connecting",
      webhookSecret: webhookSecret(),
      config: JSON.stringify(config),
    })
    .returning();

  return Response.json(
    {
      ok: true,
      connection: {
        restaurantId: restaurant.marketplaceId,
        restaurantName: restaurant.name,
        connectionCode: code,
        status: created.status,
        provider: created.provider,
      },
    },
    { status: 201 },
  );
}
