"use client";

export type LocalProfile = {
  name: string;
  phone: string;
  address: string;
};

const KEY = "tablz_profile_v1";
const EMPTY: LocalProfile = { name: "", phone: "", address: "" };

/**
 * The consumer profile is device-local for now. Phase "Accounts & Payments"
 * replaces this with real authentication and server-side saved addresses.
 */
export function loadProfile(): LocalProfile {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as LocalProfile) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function saveProfile(p: Partial<LocalProfile>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadProfile(), ...p }));
  } catch {
    /* ignore */
  }
}

const ORDERS_KEY = "tablz_orders_v1";

/** Remembers references placed on this device so /orders works without auth. */
export function rememberOrder(reference: string): void {
  if (typeof window === "undefined") return;
  try {
    const list = loadOrderRefs().filter((r) => r !== reference);
    list.unshift(reference);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* ignore */
  }
}

export function loadOrderRefs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
