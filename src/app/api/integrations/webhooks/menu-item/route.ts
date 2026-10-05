import { NextRequest } from "next/server";
import {
  applyMenuWebhook,
  getMenuItemById,
  getMenuWebhookEvent,
  getRestaurantIdByMarketplaceId,
  getWebhookContext,
} from "@/db/menu-sync";
import type { MenuWebhookEntity } from "@/db/schema";
import {
  computeWebhookSignature,
  menuWebhookTimestampValid,
  openWebhookSecret,
  webhookSignaturesEqual,
} from "@/lib/webhook-crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonObject = Record<string, unknown>;

const ID_FIELD: Record<MenuWebhookEntity, string | null> = {
  item: "item_id",
  category: "category_id",
  modifier_group: "modifier_group_id",
  modifier: "modifier_id",
  sync: null,
};

function idPayload(
  entityType: MenuWebhookEntity,
  id: number | null,
): Record<string, number | null> {
  const field = ID_FIELD[entityType] ?? null;
  return field ? { [field]: id ?? null } : {};
}

/**
 * POST /api/integrations/webhooks/menu-item
 *
 * The POS outbox delivers every verified menu change here, signed with the
 * three-token scheme (X-Integration-ID, X-Timestamp, X-Signature). Mirrors the
 * reference receiver contract: 401 bad signature/stale timestamp, 403 unknown
 * restaurant, 200 verified (or deduplicated replay of a prior event_id — same
 * minted ids + version, never re-minted).
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const integrationId = (req.headers.get("x-integration-id") ?? "").trim();
  const tsHeader = (req.headers.get("x-timestamp") ?? "").trim();
  const signature = (req.headers.get("x-signature") ?? "").trim();

  const restaurantId = await getRestaurantIdByMarketplaceId(integrationId);
  const restaurantValid = restaurantId !== null;

  const context = restaurantId ? await getWebhookContext(restaurantId) : null;
  let secret: string | null = null;
  if (context?.webhookSecret) {
    try {
      secret = openWebhookSecret(context.webhookSecret);
    } catch {
      secret = null;
    }
  }

  const expected = secret
    ? computeWebhookSignature(secret, integrationId, tsHeader, rawBody)
    : null;
  const signatureValid =
    !!secret && !!signature && !!expected && webhookSignaturesEqual(signature, expected);
  const timestampValid = menuWebhookTimestampValid(tsHeader);
  const verified = signatureValid && timestampValid && restaurantValid;

  const body = parseBody(rawBody);
  const eventType = typeof body?.event === "string" ? body.event : null;
  const eventId = typeof body?.event_id === "string" ? body.event_id : null;
  const currentMenuVersion = context?.latestMenuVersion ?? 1;

  const diag = { signatureValid, timestampValid, restaurantValid };

  if (verified && eventId) {
    const existing = await getMenuWebhookEvent(eventId);
    if (existing) {
      const entityType = existing.entityType as MenuWebhookEntity;
      const item = entityType === "item" && existing.mintedEntityId
        ? await getMenuItemById(existing.mintedEntityId)
        : null;
      return Response.json(
        {
          received: true,
          verified: true,
          deduplicated: true,
          event: eventType,
          event_id: eventId,
          ...idPayload(entityType, existing.mintedEntityId),
          mappings: existing.mappings ?? {},
          menu_version: currentMenuVersion,
          item,
          _diag: diag,
        },
        { status: 200 },
      );
    }
  }

  if (!verified) {
    const status = signatureValid === false ? 401 : timestampValid === false ? 401 : 403;
    return Response.json(
      {
        received: true,
        verified,
        deduplicated: false,
        event: eventType,
        event_id: eventId,
        _diag: diag,
      },
      { status },
    );
  }

  if (!body) {
    return Response.json(
      { received: true, verified: true, deduplicated: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const result = await applyMenuWebhook(restaurantId!, body);

  const itemFields = describeItemFields(body);
  if (itemFields) {
    console.log(`[menu-sync] ${integrationId} ${result.eventType} ${itemFields}`);
  }

  const entityType = (result.entityType ?? "sync") as MenuWebhookEntity;

  return Response.json({
    received: true,
    verified: true,
    deduplicated: false,
    event: result.eventType,
    event_id: result.eventId,
    ...idPayload(entityType, result.mintedEntityId),
    mappings: result.eventType === "menu.sync" ? result.mappings : undefined,
    menu_version: result.menuVersion,
    item: result.item,
    _diag: diag,
  });
}

/**
 * Names of the fields the POS actually sends on a menu item, plus one truncated
 * sample per string field.
 *
 * This exists because the payload is not retained anywhere, so a dish photo that
 * fails to sync leaves no trace: the only surviving evidence was `image_url`
 * holding `Starter` and `🍽️` for restaurant XYZ, which proves the image field
 * carried a category name but not which key it came from. Without this, every
 * follow-up question about the POS menu contract has to be answered by guessing.
 * One line per sync, menu data only — no credentials are in the body.
 */
function describeItemFields(body: JsonObject): string | null {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return null;

  const keys = new Set<string>();
  const samples = new Map<string, string>();
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    for (const [key, value] of Object.entries(entry as JsonObject)) {
      keys.add(key);
      if (typeof value === "string" && value && !samples.has(key)) {
        samples.set(key, value.slice(0, 60));
      }
    }
  }
  if (keys.size === 0) return null;
  return `itemKeys=[${[...keys].sort().join(",")}] samples=${JSON.stringify(
    Object.fromEntries(samples),
  )}`;
}

function parseBody(raw: string): JsonObject | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as JsonObject;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}