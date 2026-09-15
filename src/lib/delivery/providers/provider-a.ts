import type {
  DeliveryProvider,
  ProviderCancelOutcome,
  ProviderQuote,
  ProviderTracking,
} from "./types";
import type { LatLng } from "@/lib/geo";
import { haversineKm } from "@/lib/geo";

/**
 * PHASE 12 — "provider-a": a 3rd-party fleet integrated through the provider
 * seam. At this stage the fleet is stateless (no webhooks yet), so:
 *   • `createDelivery` returns a deterministic external id → the marketplace
 *     records it on `delivery_orders` and the admin queue stays authoritative.
 *   • `getQuote` prices a route independently (the marketplace can preview
 *     fees/ETA without committing).
 *   • `getStatus`/`getTracking` resolve against what the fleet has reported.
 */

const BASE_FEE = 40;
const FEE_PER_KM = 26;
const KMH = 24;
const ROAD_FACTOR = 1.3;

function etaForKm(km: number): number | null {
  return km <= 0 ? null : Math.max(12, Math.round((km * ROAD_FACTOR * 60) / KMH));
}

export const ProviderADeliveryProvider: DeliveryProvider = {
  id: "provider-a",
  kind: "external",

  async getQuote({ pickup, dropoff }): Promise<ProviderQuote> {
    const km = routeKm(pickup, dropoff);
    return {
      fee: Number((BASE_FEE + km * FEE_PER_KM).toFixed(2)),
      etaMinutes: etaForKm(km),
    };
  },

  async createDelivery({ reference }): Promise<{
    provider: "provider-a";
    externalId: string;
    status: "dispatched";
    etaMinutes: null;
  }> {
    // Real integration: POST to the fleet API, receive its tracking id. Here a
    // deterministic id keeps status/tracking lookups resolvable end-to-end.
    return {
      provider: "provider-a",
      externalId: `pax_${reference}`,
      status: "dispatched",
      etaMinutes: null,
    };
  },

  async cancelDelivery(): Promise<ProviderCancelOutcome> {
    // Stateless fleet — nothing to cancel until the integration lands.
    return { ok: true };
  },

  async getStatus(externalId: string) {
    // Fleet-drive status is not reported yet; the order stays live in the
    // marketplace dispatch queue until a partner claims it.
    return {
      provider: "provider-a",
      externalId,
      status: "queued" as const,
      etaMinutes: null,
    };
  },

  async getTracking(externalId: string): Promise<ProviderTracking> {
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