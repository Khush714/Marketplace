import { verifyInboundWebhook } from "@/lib/integrations";
import { processInboundWebhook } from "@/lib/webhook-inbound";
import type {
  InboundWebhookBody,
  InboundWebhookResponse,
} from "@/lib/integration-contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/webhooks/restaurantai
 *
 * PHASE 13 — unified inbound webhook receiver. Every event from RestaurantAI
 * arrives here: lifecycle transitions, availability updates, menu changes,
 * health pings. The flow is:
 *
 *   1. Signature verification (HMAC-SHA256 with the per-restaurant webhook_secret)
 *   2. Restaurant identity (resolved from the signing secret)
 *   3. Event validation (event, event_id, restaurant_id are required)
 *   4. Event ID dedup (unique constraint prevents double-processing)
 *   5. Record in webhook_events (direction='inbound', status='received')
 *   6. Process event (transitionOrder, availability flip, menu ack, health)
 *   7. Return ack { ok, eventId, processed }
 *
 * The restaurant_id in the body is validated against the signing integration:
 * a signed webhook can never impersonate another restaurant.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = await verifyInboundWebhook(request, rawBody);
  if (!auth) {
    return Response.json(
      { ok: false, error: "Missing, stale, or invalid webhook signature" },
      { status: 401 },
    );
  }

  let body: InboundWebhookBody;
  try {
    body = JSON.parse(rawBody) as InboundWebhookBody;
  } catch {
    return Response.json(
      { ok: false, error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const result = await processInboundWebhook(body, auth.restaurantId);
  const status = result.ok ? 200 : 400;
  return Response.json(result satisfies InboundWebhookResponse, { status });
}