import type {
  DeliveryCreateRequest,
  DeliveryProvider,
  ProviderDeliveryOutcome,
  ProviderQuote,
  ProviderStatus,
  ProviderTracking,
} from "./types";
import type { LatLng } from "@/lib/geo";
import { haversineKm } from "@/lib/geo";
import { db } from "@/db";
import { deliveryOrders } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * PHASE 12 — the internal provider: the marketplace's own fleet + the
 * restaurants' in-house riders, both driven by the delivery.ts engine. Dispatch
 * itself happens inside `dispatchDeliveryForReadyOrder` / the admin queue;
 * this object only answers the provider-agnostic queries (quote, status,
 * tracking) so callers can treat "internal" exactly like a 3rd-party fleet.
 */

/** Realistic platform-fleet averages (urban traffic incl. last-mile). */
const KMH = 22;
const ROAD_FACTOR = 1.3;

function etaForKm(km: number): number {
  return km <= 0 ? 0 : Math.max(8, Math.round((km * ROAD_FACTOR * 60) / KMH));
}

export const InternalDeliveryProvider: DeliveryProvider = {
  id: "internal",
  kind: "internal",

  async getQuote({ pickup, dropoff }): Promise<ProviderQuote> {
    const km = routeKm(pickup, dropoff);
    return {
      fee: Number((5 + km * 24).toFixed(2)),
      etaMinutes: etaForKm(km),
    };
  },

  async createDelivery({ orderId }: DeliveryCreateRequest): Promise<ProviderDeliveryOutcome> {
    // Internal dispatch is engine-driven — if a track already exists we just
    // mirror its status; otherwise the order is still in the dispatch queue.
    const [track] = await db
      .select()
      .from(deliveryOrders)
      .where(eq(deliveryOrders.orderId, orderId))
      .limit(1);
    return {
      provider: "internal",
      externalId: track ? `internal:${orderId}` : null,
      status: track ? mapInternalStatus(track.deliveryStatus) : "queued",
      etaMinutes: track?.estimatedDeliveryAt
        ? Math.max(
            0,
            Math.round(
              (new Date(track.estimatedDeliveryAt).getTime() - Date.now()) /
                60_000,
            ),
          )
        : null,
    };
  },

  async cancelDelivery(): Promise<{ ok: boolean; error?: string }> {
    // Internal fleet dispatch is managed through the admin dispatch queue
    // (unassign / cancel endpoints) — there is no independent fleet cancel.
    return {
      ok: false,
      error: "Internal deliveries are managed via the dispatch queue",
    };
  },

  async getStatus(externalId: string): Promise<ProviderDeliveryOutcome> {
    const orderId = Number(/^internal:(\d+)$/.exec(externalId)?.[1]);
    if (!Number.isFinite(orderId)) {
      return { provider: "internal", externalId, status: "queued", etaMinutes: null };
    }
    const [track] = await db
      .select()
      .from(deliveryOrders)
      .where(eq(deliveryOrders.orderId, orderId))
      .limit(1);
    if (!track) {
      return { provider: "internal", externalId, status: "queued", etaMinutes: null };
    }
    return {
      provider: "internal",
      externalId,
      status: mapInternalStatus(track.deliveryStatus),
      etaMinutes: track.estimatedDeliveryAt
        ? Math.max(
            0,
            Math.round(
              (new Date(track.estimatedDeliveryAt).getTime() - Date.now()) /
                60_000,
            ),
          )
        : null,
    };
  },

  async getTracking(externalId: string): Promise<ProviderTracking> {
    // Live fixes for internal deliveries flow over the rider SSE channel and
    // are rendered from the assignment directly — no fleet polling needed.
    return {
      externalId,
      status: null,
      lat: null,
      lng: null,
      heading: null,
      at: null,
      distanceKm: null,
      etaMinutes: null,
    };
  },
};

function routeKm(a: LatLng | null, b: LatLng | null): number {
  if (!a || !b) return 0;
  return haversineKm(a, b);
}

function mapInternalStatus(status: string): ProviderStatus {
  switch (status) {
    case "assigned":
    case "accepted":
    case "at_restaurant":
      return "dispatched";
    case "picked_up":
      return "picked_up";
    case "out_for_delivery":
      return "out_for_delivery";
    case "arriving":
      return "arriving";
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "queued";
  }
}