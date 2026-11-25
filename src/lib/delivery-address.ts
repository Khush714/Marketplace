/**
 * Customer delivery addresses for the storefront checkout.
 *
 * The saved-address book is device-local (the profile record in localStorage),
 * while the text actually placed on an order is derived here from the structured
 * fields. Keeping the derivation pure makes it testable without a browser and
 * keeps the checkout whitelist free of raw address objects.
 */

import { DEFAULT_LOCALITY } from "@/lib/domain";

export const ADDRESS_LABELS = ["Home", "Work", "Other"] as const;

export type AddressLabel = (typeof ADDRESS_LABELS)[number];

/**
 * `text` is the canonical value sent to the order API. Account-backed addresses
 * only carry `id`/`label`/`text`; addresses saved by the map picker also carry
 * the structured fields and coordinates that produced that text.
 */
export interface Address {
  id: string;
  label: string;
  text: string;
  house?: string;
  street?: string;
  area?: string;
  landmark?: string;
  city?: string;
  pincode?: string;
  phone?: string;
  instructions?: string;
  placeName?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export type MapPoint = { latitude: number; longitude: number };

/** The demo kitchens are in Bharuch, so the map opens on the first served area. */
export const DEFAULT_MAP_POINT: MapPoint = {
  latitude: DEFAULT_LOCALITY.lat,
  longitude: DEFAULT_LOCALITY.lng,
};

const SELECTED_ADDRESS_STORAGE_KEY = "crave.delivery-address-selected.v1";

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90
    ? value
    : null;
}

/** Accept only a well-formed, bounded map point; malformed payloads are dropped. */
export function mapPoint(raw: unknown): MapPoint | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const latitude = coordinate(record.latitude);
  if (latitude === undefined || latitude === null) return undefined;
  if (typeof record.longitude !== "number" || !Number.isFinite(record.longitude) || Math.abs(record.longitude) > 180) {
    return undefined;
  }
  return { latitude, longitude: record.longitude };
}

/** True when an address has enough structured detail to be used for delivery. */
export function isStructuredAddress(address: Address): boolean {
  return Boolean(
    clean(address.house, 80) &&
      clean(address.city, 80) &&
      /^\d{6}$/.test(clean(address.pincode, 10)) &&
      typeof address.latitude === "number" &&
      typeof address.longitude === "number",
  );
}

/** Human-readable address without the phone number, used in the UI. */
export function addressSummary(address: Address): string {
  const locality = [clean(address.city, 80), clean(address.pincode, 10)].filter(Boolean).join(" ");
  const parts = [
    clean(address.house, 80),
    clean(address.street, 120),
    clean(address.area, 120),
    clean(address.landmark, 120) ? `Near ${clean(address.landmark, 120)}` : "",
    locality,
  ];
  const summary = parts.filter(Boolean).join(", ");
  return (summary || clean(address.placeName, 200) || clean(address.text, 500)).slice(0, 300);
}

/**
 * The address text stored on the order. The delivery phone is included so a
 * rider can reach the customer at the door even if the contact number differs.
 */
export function addressForOrder(address: Address): string {
  const summary = addressSummary(address);
  const phone = clean(address.phone, 20);
  return `${summary}${phone ? `, Phone ${phone}` : ""}`.slice(0, 500);
}

/** Sanitize a browser/account-supplied address before it enters profile state. */
export function normalizeAddress(raw: Address): Address {
  const normalized: Address = {
    id: clean(raw.id, 80),
    label: clean(raw.label, 40) || "Other",
    text: "",
    house: clean(raw.house, 80),
    street: clean(raw.street, 120),
    area: clean(raw.area, 120),
    landmark: clean(raw.landmark, 120),
    city: clean(raw.city, 80),
    pincode: clean(raw.pincode, 10),
    phone: clean(raw.phone, 20),
    instructions: clean(raw.instructions, 200),
    placeName: clean(raw.placeName, 200),
    latitude: coordinate(raw.latitude),
    longitude: coordinate(raw.longitude),
  };
  const summary = addressSummary(normalized);
  return { ...normalized, text: summary || clean(raw.text, 500) };
}

export function blankAddress(): Address {
  return {
    id: "",
    label: "Home",
    text: "",
    house: "",
    street: "",
    area: "",
    landmark: "",
    city: "",
    pincode: "",
    phone: "",
    instructions: "",
    placeName: "",
    latitude: null,
    longitude: null,
  };
}

/** The selected address survives reloads even when it is an account address. */
export function loadSelectedAddressId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_ADDRESS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistSelectedAddressId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SELECTED_ADDRESS_STORAGE_KEY, id);
    else window.localStorage.removeItem(SELECTED_ADDRESS_STORAGE_KEY);
  } catch {
    /* Private-mode storage failures must not break checkout. */
  }
}
