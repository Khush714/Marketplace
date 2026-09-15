import type { LatLng } from "@/lib/geo";

/**
 * PHASE 12 — the delivery provider seam.
 *
 * The marketplace only ever talks to a `DeliveryProvider`. Whether the food
 * travels with the restaurant's own rider, a marketplace-platform partner, or
 * a 3rd-party fleet (provider-a / provider-b) is a dispatch decision — the
 * ordering, admin and tracking layers never reference a concrete fleet.
 *
 *   dispatchDeliveryForReadyOrder ──► getDeliveryProvider(mode)
 *                                              ├─ internal   (restaurant riders / platform fleet)
 *                                              ├─ provider-a (3rd-party fleet)
 *                                              └─ provider-b (3rd-party fleet, different terms)
 */

/** Stable fleet identifiers persisted in `delivery_orders.provider`. */
export type DeliveryProviderId = "internal" | "provider-a" | "provider-b";

/** internal = owned fleet (the delivery.ts engine); external = 3rd-party. */
export type DeliveryProviderKind = "internal" | "external";

/** Fleet-translated delivery status (normalised from provider-specific keys). */
export type ProviderStatus =
  | "queued"
  | "dispatched"
  | "picked_up"
  | "out_for_delivery"
  | "arriving"
  | "delivered"
  | "failed"
  | "cancelled";

export type ProviderQuote = {
  fee: number;
  etaMinutes: number | null;
};

export type ProviderDeliveryOutcome = {
  provider: DeliveryProviderId;
  /** The fleet's own tracking id (null = not yet handed over). */
  externalId: string | null;
  status: ProviderStatus;
  etaMinutes: number | null;
};

export type DeliveryQuoteRequest = {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  scheduledFor?: Date | null;
};

export type DeliveryCreateRequest = {
  orderId: number;
  reference: string;
  restaurant: {
    id: number;
    name: string;
    lat: number | null;
    lng: number | null;
  };
  dropoff: LatLng | null;
  customer: { name: string; phone: string | null };
  fee: number;
  scheduledFor: Date | null;
};

export type ProviderTracking = {
  externalId: string;
  status: ProviderStatus | null;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  at: string | null;
  distanceKm: number | null;
  etaMinutes: number | null;
};

export type ProviderCancelOutcome = { ok: boolean; error?: string };

export interface DeliveryProvider {
  readonly id: DeliveryProviderId;
  readonly kind: DeliveryProviderKind;
  /** Freight + time quote for a route (never requires a committed delivery). */
  getQuote(req: DeliveryQuoteRequest): Promise<ProviderQuote>;
  /** Hand the order to the fleet. Returns the fleet's external id. */
  createDelivery(req: DeliveryCreateRequest): Promise<ProviderDeliveryOutcome>;
  /** Ask the fleet to abandon a delivery already handed over. */
  cancelDelivery(externalId: string): Promise<ProviderCancelOutcome>;
  /** Fleet-agnostic status for a handed-over delivery. */
  getStatus(externalId: string): Promise<ProviderDeliveryOutcome>;
  /** Live tracking fix for a handed-over delivery (null fields = no fix). */
  getTracking(externalId: string): Promise<ProviderTracking>;
}