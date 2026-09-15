import type {
  DeliveryProvider,
  ProviderCancelOutcome,
  ProviderQuote,
  ProviderTracking,
} from "./types";
import type { LatLng } from "@/lib/geo";
import { haversineKm } from "@/lib/geo";

/**
 * PHASE 12 — "provider-b": a second 3rd-party fleet on the same seam. Same
 * contract as provider-a but with different commercial terms (cheaper base,
 * volume pricing) to prove the orchestration layer stays fleet-agnostic.
 */

const BASE_FEE = 30;
const FEE_PER_KM = 20;
const KMH = 20;
const ROAD_FACTOR = 1.35;

function etaForKm(km: number): number | null {
  return km <= 0 ? null : Math.max(14, Math.round((km * ROAD_FACTOR * 60) / KMH));
}

export const ProviderBDeliveryProvider: DeliveryProvider = {
  id: "provider-b",
  kind: "external",

  async getQuote({ pickup, dropoff }): Promise<ProviderQuote> {
    const km = routeKm(pickup, dropoff);
    return {
      fee: Number((BASE_FEE + km * FEE_PER_KM).toFixed(2)),
      etaMinutes: etaForKm(km),
    };
  },

  async createDelivery({ reference }): Promise<{
    provider: "provider-b";
    externalId: string;
    status: "dispatched";
    etaMinutes: null;
  }> {
    return {
      provider: "provider-b",
      externalId: `pbc_${reference}`,
      status: "dispatched",
      etaMinutes: null,
    };
  },

  async cancelDelivery(): Promise<ProviderCancelOutcome> {
    return { ok: true };
  },

  async getStatus(externalId: string) {
    return {
      provider: "provider-b",
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