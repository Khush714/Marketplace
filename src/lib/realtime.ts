import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * PHASE 28 — real-time order updates.
 *
 * The marketplace publishes a lightweight event per order mutation (place,
 * cancel, lifecycle transition) via Postgres LISTEN/NOTIFY. The SSE endpoint
 * subscribes to the channel and fans each event out to open trackers.
 *
 * Publish is post-commit and fire-and-forget: the notification is delivered
 * asynchronously to any LISTEN client, so a slow consumer never blocks the
 * ordering path. pg_notify is a no-op when nothing is listening.
 */

export const ORDER_CHANNEL = "marketplace_orders";

export type OrderEvent = {
  reference: string;
  status: string;
  actor: string;
  at: string;
};

/**
 * PHASE 30 — live rider position updates. Kept on a SEPARATE channel from
 * order-status events so a high-frequency location tick never wakes every
 * open order tracker or re-fan-outs a full order snapshot. Lightweight
 * payload: reference + the latest fix only.
 */
export const RIDER_CHANNEL = "marketplace_rider_locations";

export type RiderLocationEvent = {
  reference: string;
  lat: number;
  lng: number;
  heading: number | null;
  at: string;
};

/** Post-commit order mutation event. Never throws into the caller. */
export async function publishOrderEvent(
  reference: string,
  status: string,
  actor: string = "system",
): Promise<void> {
  const event: OrderEvent = {
    reference,
    status,
    actor,
    at: new Date().toISOString(),
  };
  try {
    // Parameterized so payload quotes are never an injection surface.
    await db.execute(
      sql`SELECT pg_notify(${ORDER_CHANNEL}, ${JSON.stringify(event)})`,
    );
  } catch (e) {
    // Real-time is an enhancement — never break ordering over a notify glitch.
    console.error("publishOrderEvent failed", reference, e);
  }
}

/** Post-commit rider position fix. Never throws into the caller. */
export async function publishRiderLocation(
  reference: string,
  fix: { lat: number; lng: number; heading: number | null; at: string },
): Promise<void> {
  const event: RiderLocationEvent = {
    reference,
    lat: fix.lat,
    lng: fix.lng,
    heading: fix.heading,
    at: fix.at,
  };
  try {
    await db.execute(
      sql`SELECT pg_notify(${RIDER_CHANNEL}, ${JSON.stringify(event)})`,
    );
  } catch (e) {
    console.error("publishRiderLocation failed", reference, e);
  }
}