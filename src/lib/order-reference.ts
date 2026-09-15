import { randomBytes } from "node:crypto";

/**
 * PHASE 14 — the marketplace reference IS the customer's access credential for
 * the ordering/tracking surface (`/api/marketplace/orders/:reference`,
 * `/events`, `/location`). It therefore comes from a CSPRNG — never
 * `Math.random` — and must stay unguessable, opaque and reference-only.
 *
 * Format: `MKT-<18 hex>`. The shared regex below is the one shape the
 * public-facing order routes accept; anything else (including bare numeric id
 * attempts) is rejected before it ever reaches the database.
 */
export function orderReference(): string {
  return `MKT-${randomBytes(9).toString("hex").toUpperCase()}`;
}

/** Accepted shape for a public order reference (also keys the SSE stream). */
export const PUBLIC_ORDER_REFERENCE_RE = /^MKT-[A-Z0-9]+$/;

/**
 * True when the reference is a bare numeric id. Sequential numeric ids were the
 * original enumeration vector (`/order/42 → someone else's rider`); public
 * routes reject these outright so a future id-lookup cannot be reintroduced by
 * accident.
 */
export function isNumericReference(reference: string): boolean {
  return /^\d+$/.test(reference);
}