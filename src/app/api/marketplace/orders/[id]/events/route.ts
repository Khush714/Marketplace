import type { PublicOrder } from "@/lib/marketplace";
import { getPublicOrder } from "@/lib/marketplace";
import { pool } from "@/db";
import { ORDER_CHANNEL, RIDER_CHANNEL } from "@/lib/realtime";
import { getRiderLocationForReference, type RiderFix } from "@/lib/delivery";
import {
  marketplaceOrderingEnabled,
  ORDERING_DISABLED_MESSAGE,
} from "@/lib/feature-flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REF_RE = /^[A-Z0-9-]{4,24}$/;
const PUMP_MS = 3000; // fallback cadence when LISTEN is unavailable
const LOCATION_PUMP_MS = 12_000; // fallback cadence for rider fixes
const KEEPALIVE_MS = 15_000;
const MAX_STREAM_MS = 60 * 60 * 1000; // hard ceiling for a tracker session

/**
 * GET /api/marketplace/orders/:reference/events — Server-Sent Events stream.
 *
 * Phases a real-time tracker past 5s polling: the client opens one long-lived
 * connection and receives the order snapshot whenever it changes.
 *
 * Events (SSE `event:` + `data:` JSON):
 *   event: order   → { order: PublicOrder }    (initial + every change)
 *   event: rider   → { rider: RiderFix | null } (PHASE 30 live position fix)
 *   event: error   → { code: "not_found" | "server" }
 *   event: close   → terminal sentinel (stream ends after this)
 *   comment `: keepalive` every 15s while live.
 *
 * Mechanism:
 *   1. Push the current snapshot immediately.
 *   2. Subscribe to Postgres LISTEN on marketplace_orders AND
 *      marketplace_rider_locations (src/lib/realtime.ts broadcasts each on its
 *      own channel). Order mutations push a full snapshot; rider fixes push a
 *      LIGHTWEIGHT `rider` event so a position tick never re-renders the whole
 *      order rail.
 *   3. If LISTEN cannot connect (pool exhausted / serverless reconnect), fall
 *      back to server-side poll pumps (order snapshot every 3s, rider fix every
 *      12s) so the stream still works.
 *   4. Snapshots are deduplicated by JSON equality — a transition is pushed
 *      exactly once. Terminal orders close the stream.
 *
 * The reference is the access credential (matching the order GET contract),
 * so no session is required.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!marketplaceOrderingEnabled) {
    return Response.json({ error: ORDERING_DISABLED_MESSAGE }, { status: 410 });
  }

  const { id } = await params;
  const reference = id.trim().toUpperCase();
  if (!REF_RE.test(reference)) {
    return Response.json({ error: "Bad reference" }, { status: 400 });
  }

  const enc = new TextEncoder();
  // Shared between start() (assigns it) and cancel() (invokes it).
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        cleanup?.();
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          close();
        }
      };

      const ping = () => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`: keepalive\n\n`));
        } catch {
          close();
        }
      };

      // Snapshots are full `{ order }` payloads; equality dedupes so a
      // transition is pushed exactly once (NOTIFY + pump can overlap).
      let lastKey: string | null = null;
      const push = async (snapshot: PublicOrder | null) => {
        const key = snapshot ? JSON.stringify({ order: snapshot }) : null;
        if (key === lastKey || closed) return;
        lastKey = key;

        if (!snapshot) {
          send("error", { code: "not_found" });
          close();
          return;
        }
        send("order", { order: snapshot });
        if (snapshot.lifecycle.terminal) {
          send("close", {});
          close();
        }
      };

      // PHASE 30 — rider fixes are their own lightweight event family. They
      // live on the rider channel so a high-frequency location tick never
      // wakes the full-order path above (which would re-render the tracker).
      let lastRiderKey: string | null = null;
      const pushRider = (fix: RiderFix | null) => {
        if (closed) return;
        const key = fix
          ? `${fix.lat}:${fix.lng}:${fix.heading ?? ""}:${fix.at}`
          : "none";
        if (key === lastRiderKey) return;
        lastRiderKey = key;
        send("rider", { rider: fix });
      };

      // ── Initial snapshot — establishes 404 semantics on the stream ─────
      getPublicOrder(reference)
        .then((s) => {
          if (closed) return;
          void push(s);
        })
        .catch(() => {
          if (!closed) send("error", { code: "server" });
        });

      // ── Postgres LISTEN (event-driven when available) ──────────────────
      let listening = false;
      let pumpId: ReturnType<typeof setInterval> | null = null;
      let listener: import("pg").PoolClient | null = null;

      pool
        .connect()
        .then(async (client) => {
          if (closed) {
            client.release();
            return;
          }
          listener = client;
          client.on("notification", (msg) => {
            if (closed) return;
            try {
              const payload = JSON.parse(msg.payload ?? "{}") as {
                reference?: string;
              };
              if (payload.reference !== reference) return;

              if (msg.channel === RIDER_CHANNEL) {
                // A location tick: push only the lightweight rider fix.
                void getRiderLocationForReference(reference)
                  .then(pushRider)
                  .catch(() => {
                    /* transient DB error — next tick retries */
                  });
                return;
              }
              void getPublicOrder(reference)
                .then(push)
                .catch(() => {
                  if (!closed) send("error", { code: "server" });
                });
            } catch {
              /* ignore malformed payload */
            }
          });
          client.on("error", () => {
            // Postgres drops the idling client; the pump below takes over.
            listening = false;
          });
          try {
            await client.query(`LISTEN ${ORDER_CHANNEL}`);
            await client.query(`LISTEN ${RIDER_CHANNEL}`);
            listening = true;
          } catch {
            client.release();
            listener = null;
          }
        })
        .catch(() => {
          // connect() failed — the fallback pump keeps the stream alive.
        });

      // ── Fallback pumps: only run while LISTEN is not connected ────────
      pumpId = setInterval(() => {
        if (closed || listening) return;
        void getPublicOrder(reference)
          .then((s) => {
            if (closed) return;
            void push(s);
          })
          .catch(() => {
            /* transient DB error — next tick retries */
          });
        void getRiderLocationForReference(reference)
          .then((fix) => {
            if (closed) return;
            pushRider(fix);
          })
          .catch(() => {
            /* transient DB error — next tick retries */
          });
      }, PUMP_MS);

      // PHASE 30 — when LISTEN is healthy, rider fixes arrive event-driven,
      // but a 12s location pump (always on) guarantees the map stays warm even
      // if a rider stops between fixes or a NOTIFY was lost. Cheap: deduped.
      const riderPump = setInterval(() => {
        if (closed) return;
        void getRiderLocationForReference(reference)
          .then((fix) => {
            if (closed) return;
            pushRider(fix);
          })
          .catch(() => {
            /* transient DB error — next tick retries */
          });
      }, LOCATION_PUMP_MS);

      // Keepalive keeps proxy tunnels and NAT table entries warm.
      const keepalive = setInterval(ping, KEEPALIVE_MS);

      // Hard ceiling so a zombie tracker session never hoards a connection.
      const maxAge = setTimeout(() => {
        send("close", { reason: "timeout" });
        close();
      }, MAX_STREAM_MS);

      cleanup = () => {
        if (pumpId) clearInterval(pumpId);
        clearInterval(riderPump);
        clearInterval(keepalive);
        clearTimeout(maxAge);
        if (listener) {
          void listener
            .query(`UNLISTEN ${ORDER_CHANNEL}; UNLISTEN ${RIDER_CHANNEL}`)
            .catch(() => undefined)
            .finally(() => listener?.release());
          listener = null;
        }
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}