import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { withIdempotency } from "@/lib/idempotency";
import type { InboundWebhookBody } from "@/lib/integration-contract";
import {
  IDEMPOTENCY_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "@/lib/integration-contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/test/fake-pos/integration/orders
 *
 * PHASE 14 — fake POS order receiver (reference RestaurantAI implementation).
 * When the marketplace outbound dispatcher sends POST {endpoint_url}/integration/orders,
 * this route receives it. It acknowledges immediately and starts a background
 * loop that calls back the marketplace's unified webhook receiver with realistic
 * status transitions:
 *
 *   ORDER_CREATED → ACCEPTED (1s) → PREPARING (2s) → READY (3s) → DELIVERED (4s)
 *
 * PHASE 17 — idempotency. The fake POS MUST mimic RestaurantAI's dedup contract:
 * it keys on the request's `external_order_id` scoped to the restaurant and
 * caches the first response. A retried delivery (same external_order_id) is
 * answered with the cached response and does NOT start the transition loop a
 * second time — so the same customer order is never prepared twice.
 */
const MARKETPLACE_WEBHOOK_URL =
  process.env.MARKETPLACE_URL
    ? `${process.env.MARKETPLACE_URL}/api/integrations/webhooks/restaurantai`
    : "http://127.0.0.1:3000/api/integrations/webhooks/restaurantai";

const TRANSITIONS = [
  { delay: 1000, status: "accepted", event: "order.status_changed" as const },
  { delay: 2000, status: "preparing", event: "order.status_changed" as const },
  { delay: 3000, status: "ready", event: "order.status_changed" as const },
  { delay: 3500, status: "picked_up", event: "order.status_changed" as const },
  { delay: 4000, status: "delivered", event: "order.status_changed" as const },
];

export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The outbound contract sends an OutboundOrderEvent with external_order_id.
  const order = body.order as
    | { reference?: string; restaurant?: { marketplaceId?: string } }
    | undefined;
  const reference = order?.reference;
  const externalOrderId =
    typeof body.external_order_id === "string"
      ? (body.external_order_id as string)
      : reference;
  if (!externalOrderId) {
    return Response.json({ error: "Missing external_order_id" }, { status: 400 });
  }

  // Resolve restaurant_id and webhook_secret from the reference.
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  });

  const { rows: [orderRow] } = await pool.query(
    "SELECT id, restaurant_id FROM orders WHERE reference = $1 LIMIT 1",
    [reference ?? externalOrderId],
  );
  if (!orderRow) {
    await pool.end();
    return Response.json({ error: "Order not found" }, { status: 404 });
  }

  const { rows: [integration] } = await pool.query(
    "SELECT webhook_secret, external_restaurant_id FROM restaurant_integrations WHERE restaurant_id = $1 LIMIT 1",
    [orderRow.restaurant_id],
  );
  const secret = integration?.webhook_secret;
  if (!secret) {
    await pool.end();
    return Response.json({ error: "No webhook_secret" }, { status: 500 });
  }
  const externalId = integration?.external_restaurant_id ?? `rst_${orderRow.restaurant_id}`;
  await pool.end();

  // PHASE 17 — idempotency scope: the restaurant; key: external_order_id.
  // Everything below runs exactly once per (restaurant, external_order_id).
  const idempotencyFromHeader = request.headers.get(IDEMPOTENCY_HEADER) ?? undefined;

  const result = await withIdempotency({
    scope: `restaurant:${orderRow.restaurant_id}`,
    key: idempotencyFromHeader ?? externalOrderId,
    rawBody,
    run: async () => {
      console.log(`[fake-pos] ORDER_RECEIVED ${externalOrderId} — starting transitions`);
      void fireTransitions(orderRow.restaurant_id, reference!, externalId, secret);
      return {
        status: 200,
        body: {
          ok: true,
          reference,
          external_order_id: externalOrderId,
          message: "Order accepted by fake POS",
        },
      };
    },
  });

  return Response.json(
    result.body,
    result.conflict ? { status: 409 } : { status: result.status },
  );
}

async function fireTransitions(
  restaurantId: number,
  reference: string,
  externalId: string,
  webhookSecret: string,
): Promise<void> {
  for (const transition of TRANSITIONS) {
    await sleep(transition.delay);

    const eventId = `fake_${reference}_${transition.status}_${Date.now()}`;
    const payload: InboundWebhookBody = {
      event_id: eventId,
      event: transition.event,
      restaurant_id: externalId,
      order_id: reference,
      status: transition.status,
      occurred_at: new Date().toISOString(),
      data: { source: "fake-pos", note: `Fake POS: ${transition.status}` },
    };

    const raw = JSON.stringify(payload);
    const ts = String(Date.now());
    const sig = createHmac("sha256", webhookSecret)
      .update(`${ts}\n${raw}`)
      .digest("hex");

    try {
      const res = await fetch(MARKETPLACE_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: sig,
          [TIMESTAMP_HEADER]: ts,
        },
        body: raw,
      });
      const json = await res.json();
      console.log(
        `[fake-pos] ${reference} → ${transition.status}: ${res.status} ${json.ok ? "ok" : JSON.stringify(json)}`,
      );
    } catch (e) {
      console.error(
        `[fake-pos] ${reference} → ${transition.status} FAILED:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  console.log(`[fake-pos] ${reference} — all transitions complete ✓`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}