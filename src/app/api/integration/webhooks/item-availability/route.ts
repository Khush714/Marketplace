import { db } from "@/db";
import { menuItems, restaurantIntegrations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyInboundWebhook } from "@/lib/integrations";
import { findItemByExternalId } from "@/lib/external-map";
import type {
  ItemAvailabilityWebhookBody,
  ItemAvailabilityWebhookResponse,
} from "@/lib/integration-contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/integration/webhooks/item-availability
 * RestaurantAI pushes availability flips for items it already mapped via
 * external ids. Friendly: known ids update marketplace availability; unknown
 * ids are reported back in `ignored` — never guessed, never auto-created.
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

  let body: ItemAvailabilityWebhookBody;
  try {
    body = JSON.parse(rawBody) as ItemAvailabilityWebhookBody;
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return Response.json({ error: "items[] is required and must not be empty" }, { status: 400 });
  }

  const entries = body.items.filter((i) => i && typeof i.externalId === "string");
  if (entries.length === 0) {
    return Response.json({ error: "items[] must contain { externalId, available }" }, { status: 400 });
  }

  const updated: { externalId: string; available: boolean }[] = [];
  const ignored: { externalId: string; reason: string }[] = [];

  for (const entry of entries) {
    const row = await findItemByExternalId(auth.restaurantId, entry.externalId);
    const available = Boolean(entry.available);
    if (!row) {
      ignored.push({ externalId: entry.externalId, reason: "unknown external id" });
      continue;
    }
    await db
      .update(menuItems)
      .set({ isAvailable: available })
      .where(eq(menuItems.id, row.id));
    updated.push({ externalId: entry.externalId, available });
  }

  const now = new Date();
  await db
    .update(restaurantIntegrations)
    .set({ lastSyncAt: now, lastSuccessAt: now, healthStatus: "healthy" })
    .where(eq(restaurantIntegrations.restaurantId, auth.restaurantId));

  const res: ItemAvailabilityWebhookResponse = { ok: true, updated, ignored };
  return Response.json(res);
}