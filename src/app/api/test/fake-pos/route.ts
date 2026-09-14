import { Pool } from "pg";
import { createHmac } from "node:crypto";
import type { InboundWebhookBody } from "@/lib/integration-contract";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/integration-contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/test/fake-pos
 *
 * PHASE 14 — a fake POS simulator that behaves like RestaurantAI during
 * development. It receives ORDER_CREATED from the marketplace, acknowledges
 * immediately, then calls back the marketplace's unified webhook receiver
 * with realistic status transitions on a timer:
 *
 *   ORDER_CREATED  →  ACCEPTED (1s)  →  PREPARING (2s)  →  READY (3s)  →  DELIVERED (4s)
 *
 * Each callback is signed with the restaurant's webhook_secret so the
 * marketplace webhook infrastructure is exercised end-to-end.
 *
 * Body: { order_id, restaurant_id, reference, fulfillment }
 * The restaurant_id is the marketplace numeric id (e.g. 1).
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
  let body: {
    order_id: number;
    restaurant_id: number;
    reference: string;
    fulfillment?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.order_id || !body.restaurant_id || !body.reference) {
    return Response.json(
      { error: "order_id, restaurant_id, and reference are required" },
      { status: 400 },
    );
  }

  // Fetch the webhook secret for signing callbacks.
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  });

  const { rows: [integration] } = await pool.query(
    "SELECT webhook_secret, external_restaurant_id FROM restaurant_integrations WHERE restaurant_id = $1 LIMIT 1",
    [body.restaurant_id],
  );
  const secret = integration?.webhook_secret;
  if (!secret) {
    await pool.end();
    return Response.json(
      { error: "No webhook_secret for this restaurant" },
      { status: 500 },
    );
  }
  const externalId = integration?.external_restaurant_id ?? `rst_${body.restaurant_id}`;
  await pool.end();

  // Start the background transition loop (fire-and-forget).
  void fireTransitions(body, secret, externalId);

  return Response.json({
    ok: true,
    message: "Order received — will process through status transitions",
    reference: body.reference,
    transitions: TRANSITIONS.map((t) => t.status),
  });
}

async function fireTransitions(
  order: { order_id: number; restaurant_id: number; reference: string },
  webhookSecret: string,
  externalId: string,
): Promise<void> {
  for (const transition of TRANSITIONS) {
    await sleep(transition.delay);

    const eventId = `fake_${order.reference}_${transition.status}_${Date.now()}`;
    const payload: InboundWebhookBody = {
      event_id: eventId,
      event: transition.event,
      restaurant_id: externalId,
      order_id: order.reference,
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
        `[fake-pos] ${order.reference} → ${transition.status}: ${res.status} ${json.ok ? "ok" : json.error}`,
      );
    } catch (e) {
      console.error(
        `[fake-pos] ${order.reference} → ${transition.status} FAILED:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  console.log(`[fake-pos] ${order.reference} — all transitions complete`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}