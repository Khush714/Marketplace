import { db } from "@/db";
import { restaurantIntegrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyInboundWebhook } from "@/lib/integrations";
import type {
  MenuUpdatedWebhookBody,
  MenuUpdatedWebhookResponse,
} from "@/lib/integration-contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/webhooks/menu-updated
 * RestaurantAI signals its menu changed. The marketplace acknowledges and
 * records the moment its next pull should be forced (skips updatedSince
 * caching). Forced pulls are best-effort: the response always returns the
 * menu URL so RestaurantAI can immediately re-sync.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = await verifyInboundWebhook(request, rawBody);
  if (!auth) {
    return Response.json(
      { error: "Missing, stale, or invalid webhook signature" },
      { status: 401 },
    );
  }

  let body: MenuUpdatedWebhookBody;
  try {
    body = JSON.parse(rawBody) as MenuUpdatedWebhookBody;
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  void body;

  const now = new Date();
  await db
    .update(restaurantIntegrations)
    .set({ lastSyncAt: now, lastSuccessAt: now, healthStatus: "healthy" })
    .where(eq(restaurantIntegrations.restaurantId, auth.restaurantId));

  const res: MenuUpdatedWebhookResponse = {
    ok: true,
    acknowledgedAt: now.toISOString(),
    menuUrl: `/api/integration/menu?key=<credentials>`,
  };
  return Response.json(res);
}