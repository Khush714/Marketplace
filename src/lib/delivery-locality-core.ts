import { mapPoint, type MapPoint } from "@/lib/delivery-address";
import { LOCALITIES, localityByKey, localityNear } from "@/lib/domain";

/**
 * Delivery-area policy for checkout, kept pure so it can be tested without the
 * database or the browser. The customer's selected locality is a claim, not
 * proof of GPS, so this is an admission check rather than a geocoding service:
 * it rejects a known locality/pincode that contradicts the restaurant's served
 * locality, and it leaves legacy address-only carts alone when neither signal
 * is present. A future geocoder can replace the claim without changing callers.
 */

export type DeliveryLocalityResult =
  | { ok: true; localityKey: string | null; verified: boolean }
  | { ok: false; code: "OUTSIDE_SERVICE_AREA"; error: string };

export function knownLocalityKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return LOCALITIES.some((l) => l.key === key) ? key : null;
}

function pincodeFromAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

export function resolveDeliveryLocality(input: {
  /** Explicit selection sent by checkout, after whitelist validation. */
  localityKey?: unknown;
  /** `?loc=` from the checkout URL, used when the body carries no selection. */
  urlLocalityKey?: unknown;
  addressText?: unknown;
  /** Optional map pin from the address picker; used only as an admission signal. */
  deliveryLocation?: unknown;
  restaurantLocality: string;
}): DeliveryLocalityResult {
  const served = input.restaurantLocality.trim().toLowerCase();
  const point: MapPoint | undefined = mapPoint(input.deliveryLocation);
  const nearby = point ? localityNear(point.latitude, point.longitude) : null;
  const key =
    knownLocalityKey(input.localityKey) ??
    knownLocalityKey(input.urlLocalityKey) ??
    (nearby?.served ? nearby.locality.key : null);

  // A dropped pin is stronger evidence than a typed address: if it is outside
  // every served area, refuse before an order is written. Legacy address-only
  // carts (no pin) keep the existing claim-based behaviour. An explicit locality
  // claim still wins so an older saved address is not broken by a stale pin.
  if (nearby && !nearby.served && !key) {
    return {
      ok: false,
      code: "OUTSIDE_SERVICE_AREA",
      error: "This delivery pin is outside our service area.",
    };
  }

  if (key) {
    const locality = localityByKey(key);
    if (locality.name.trim().toLowerCase() !== served) {
      return {
        ok: false,
        code: "OUTSIDE_SERVICE_AREA",
        error: `This restaurant does not deliver to ${locality.name}`,
      };
    }
    return { ok: true, localityKey: locality.key, verified: true };
  }

  const pincode = pincodeFromAddress(input.addressText);
  if (pincode) {
    const locality = LOCALITIES.find((l) => l.pincode === pincode);
    if (!locality || locality.name.trim().toLowerCase() !== served) {
      return {
        ok: false,
        code: "OUTSIDE_SERVICE_AREA",
        error: `This restaurant does not deliver to pincode ${pincode}`,
      };
    }
    return { ok: true, localityKey: locality.key, verified: true };
  }

  return { ok: true, localityKey: null, verified: false };
}
