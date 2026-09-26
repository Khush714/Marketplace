/**
 * Canonical Marketplace order-status vocabulary — the single source of truth
 * for the Phase 5 order lifecycle. Every other layer (webhooks, transition
 * guard, tracking stages, DTOs, UI) derives from THIS module; POS statuses are
 * never renamed, only mapped at this boundary.
 *
 * Forward-only rules live here too: STATUS_ORDER ranks + VALID_TRANSITIONS
 * (the full legal-edge matrix). CANCELLED / REJECTED / COMPLETED are terminal.
 *
 * No "server-only" here on purpose: this is a pure domain module (no env, no
 * DB) so server routes, query layers, and test harnesses can all import it.
 */

export const MARKETPLACE_STATUSES = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
] as const;

export type MarketplaceOrderStatus = (typeof MARKETPLACE_STATUSES)[number];

export function isMarketplaceOrderStatus(value: string): value is MarketplaceOrderStatus {
  return (MARKETPLACE_STATUSES as readonly string[]).includes(value);
}

export const TERMINAL_STATUSES: ReadonlySet<MarketplaceOrderStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
]);

/**
 * Lifecycle rank for the monotonic forward-only guard (lower = earlier).
 * CANCELLED / REJECTED share the top rank: they can be entered from any
 * non-terminal state but never leave it (see VALID_TRANSITIONS).
 */
export const STATUS_ORDER: Record<MarketplaceOrderStatus, number> = {
  PLACED: 0,
  ACCEPTED: 1,
  PREPARING: 2,
  READY: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  COMPLETED: 6,
  CANCELLED: 7,
  REJECTED: 7,
};

export function statusRank(status: string): number {
  const rank = STATUS_ORDER[status as MarketplaceOrderStatus];
  return rank === undefined ? -1 : rank;
}

/**
 * POS vocabulary → Marketplace canonical status (spec: "mapPosStatusTo
 * MarketplaceStatus"). Keys are exact POS spellings (POS status machine uses
 * 'Pending'/'Preparing'/'Ready'/'Served'/'Completed'/'Cancelled'/'Rejected';
 * delivery lifecycle uses 'Out for Delivery'/'Delivered'; some POS variants
 * shout in UPPER). Lookup is exact first, then case-insensitive fallback.
 */
const POS_STATUS_MAP: Record<string, MarketplaceOrderStatus> = {
  NEW: "PLACED",
  PENDING: "PLACED",
  PLACED: "PLACED",
  ACCEPTED: "ACCEPTED",
  ACCEPT: "ACCEPTED",
  PREPARING: "PREPARING",
  COOKING: "PREPARING",
  READY: "READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  PICKED_UP: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  SERVED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REJECTED: "REJECTED",
  // POS-native (human-cased) spellings — exact-match keys.
  Pending: "PLACED",
  Preparing: "PREPARING",
  Cooking: "PREPARING",
  Ready: "READY",
  "Out for Delivery": "OUT_FOR_DELIVERY",
  Delivered: "DELIVERED",
  Completed: "COMPLETED",
  Served: "COMPLETED",
  Cancelled: "CANCELLED",
  Rejected: "REJECTED",
};

const POS_STATUS_LOOKUP = new Map<string, MarketplaceOrderStatus>(
  Object.entries(POS_STATUS_MAP).map(([k, v]) => [k.toUpperCase(), v]),
);

/**
 * Translate one POS-reported status into the Marketplace canonical status.
 * Returns null for internal holds / unknown vocabularies (the caller skips
 * the event — never invents a status).
 */
export function mapPosStatusToMarketplaceStatus(
  posStatus: string | null | undefined,
): MarketplaceOrderStatus | null {
  if (!posStatus) return null;
  const norm = String(posStatus).trim().toUpperCase();
  if (!norm) return null;
  return POS_STATUS_LOOKUP.get(norm) ?? null;
}

/**
 * Legal edges: [current] → allowed incoming statuses. Includes:
 *  - PLACED → PREPARING (POS may skip ACCEPTED — orders arrive kitchen-ready)
 *  - ACCEPTED absorb edges (see pos-delivery.ts absorb branch)
 *  - OUT_FOR_DELIVERY / DELIVERED in the rider handoff (spec §7)
 *  - same-status → idempotent no-op (handled before this lookup)
 * Terminals allow nothing.
 */
const VALID_TRANSITIONS: Record<MarketplaceOrderStatus, readonly MarketplaceOrderStatus[]> = {
  PLACED: ["ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REJECTED"],
  ACCEPTED: ["PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REJECTED"],
  PREPARING: ["ACCEPTED", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REJECTED"],
  READY: ["ACCEPTED", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "COMPLETED", "CANCELLED"],
  DELIVERED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

/** Is `next` a legal transition out of `current`? (same-state handled by caller) */
export function canTransition(
  current: string,
  next: MarketplaceOrderStatus,
): boolean {
  if (!isMarketplaceOrderStatus(current)) return false;
  if (current === next) return false;
  if (TERMINAL_STATUSES.has(current)) return false;
  return VALID_TRANSITIONS[current].includes(next);
}

/**
 * First-mile ACCEPTED arriving on an already-kitchen-ready order must be
 * recorded but never regress the customer timeline (POS fires order.accepted
 * after ingest already pushed PREPARING).
 */
export function isAbsorbedAccepted(current: string, next: MarketplaceOrderStatus): boolean {
  return (
    next === "ACCEPTED" &&
    (current === "PREPARING" || current === "READY" || current === "OUT_FOR_DELIVERY")
  );
}
