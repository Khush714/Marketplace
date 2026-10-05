import "server-only";

/**
 * Input validation and length limits. Centralise string/array bounds to prevent
 * oversized payloads and to keep policy consistent across APIs.
 */

export const MAX_NAME = 80;
export const MAX_PHONE = 20;
export const MAX_ADDRESS = 500;
export const MAX_INSTRUCTIONS = 500;
export const MAX_SLUG = 120;
export const MAX_EXTERNAL_ID = 64;
export const MAX_CUISINE_NAME = 24;
export const MAX_CUISINES = 4;
export const MAX_CART_ITEMS = 50;
export const MIN_QTY = 1;
export const MAX_QTY = 99;

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function isNonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

export function isSlug(s: string): boolean {
  // Simple slug: lowercase letters/numbers/dashes/underscores, 1-120 chars.
  return /^[a-z0-9_-]{1,120}$/.test(s);
}

export function isConnectionCode(s: string): boolean {
  // Approximate format used in the system; be permissive but bounded.
  return /^[A-Z0-9]{4,12}$/i.test(s.trim());
}

export function sanitizeString(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.length === 0) return null;
  return truncate(t, max);
}

export function sanitizeArray<T>(
  arr: unknown,
  maxItems: number,
  fn: (v: unknown, i: number) => T | null,
): T[] {
  if (!Array.isArray(arr)) return [];
  const out: T[] = [];
  for (let i = 0; i < Math.min(arr.length, maxItems); i++) {
    const v = fn(arr[i], i);
    if (v != null) out.push(v);
  }
  return out;
}