/**
 * PHASE 9 — canonical order lifecycle. This file is the CONTRACT, both for the
 * marketplace's own screens and for RestaurantAI when the POS finally connects.
 * The UI and the transition endpoints must never re-implement these rules.
 *
 *   PLACED → ACCEPTED → PREPARING → READY → PICKED_UP → DELIVERED
 *   PLACED → REJECTED
 *   ACCEPTED → CANCELLED
 *
 * Wire/DB keys are lowercase and stable; `CONTRACT_STATUS` exposes the
 * uppercase contract notation for display (PLACED / PICKED UP / …). Historical
 * ad-hoc rows (pending/confirmed/completed/out_for_delivery) are mapped at read
 * time onto this lifecycle so nothing is lost. `completed` is now the legacy
 * alias for `delivered` — writes must use the canonical key.
 */

export type OrderLifecycleStatus =
  | "placed"
  | "accepted"
  | "preparing"
  | "ready"
  | "picked_up"
  | "delivered"
  | "cancelled"
  | "rejected";

/** Every canonical state the marketplace/POS can hold (wire contract). */
export const ORDER_STATUSES: OrderLifecycleStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "delivered",
  "cancelled",
  "rejected",
];

/**
 * The forward mainline. Rails, timelines and steppers consume THIS array so a
 * lifecycle change only ever lands in one place.
 */
export const ORDER_MAINLINE: OrderLifecycleStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "delivered",
];

export const ORDER_LABELS: Record<OrderLifecycleStatus, string> = {
  placed: "Order placed",
  accepted: "Restaurant accepted",
  preparing: "Preparing",
  ready: "Ready",
  picked_up: "Picked up",
  delivered: "Delivered",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

/**
 * Uppercase contract keys — what the RestaurantAI spec calls PLACED, ACCEPTED,
 * PICKED_UP etc. Status chips render these so the customer always sees the
 * contract value while prose keeps the friendlier label.
 */
export const CONTRACT_STATUS: Record<OrderLifecycleStatus, string> = {
  placed: "PLACED",
  accepted: "ACCEPTED",
  preparing: "PREPARING",
  ready: "READY",
  picked_up: "PICKED UP",
  delivered: "DELIVERED",
  cancelled: "CANCELLED",
  rejected: "REJECTED",
};

/** True when the value is one of the canonical wire/DB keys. */
export function isCanonicalStatus(status: string): boolean {
  return (ORDER_STATUSES as string[]).includes(status);
}

/** Canonical read-path label (used by the customer app and POS queue). */
export function statusLabel(status: string): string {
  const canonical = legacyToCanonical(status);
  return ORDER_LABELS[canonical] ?? status;
}

/** Whether the status is a "live" (non-terminal) state. */
export function isTerminal(status: string): boolean {
  const s = legacyToCanonical(status);
  return s === "delivered" || s === "cancelled" || s === "rejected";
}

/**
 * Map legacy / ad-hoc statuses onto the canonical lifecycle. Keeps old rows
 * (pending, confirmed, completed, out_for_delivery) meaningful after this
 * phase ships. `completed` is a legacy alias for `delivered`.
 */
export function legacyToCanonical(status: string): OrderLifecycleStatus {
  switch (status) {
    case "placed":
    case "pending":
      return "placed";
    case "accepted":
    case "confirmed":
      return "accepted";
    case "preparing":
      return "preparing";
    case "ready":
      return "ready";
    case "picked_up":
      return "picked_up";
    case "delivered":
    case "completed":
    case "out_for_delivery":
      return "delivered";
    case "cancelled":
      return "cancelled";
    case "rejected":
      return "rejected";
    default:
      return "placed";
  }
}

/** Forward (canonical) step index used by the customer progress tracker. */
export function stepIndex(status: string): number {
  const idx = ORDER_MAINLINE.indexOf(legacyToCanonical(status));
  return idx === -1 ? 0 : idx;
}

const TRANSITIONS: Record<OrderLifecycleStatus, OrderLifecycleStatus[]> = {
  placed: ["accepted", "rejected"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready"],
  ready: ["picked_up"],
  picked_up: ["delivered"],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export function nextStatuses(
  current: OrderLifecycleStatus,
): OrderLifecycleStatus[] {
  return TRANSITIONS[current] ?? [];
}

export function canTransition(from: string, to: string): boolean {
  const f = legacyToCanonical(from);
  const t = legacyToCanonical(to);
  if (f === t) return false;
  return TRANSITIONS[f]?.includes(t) ?? false;
}

/** Summary shape for the POS queue / customer tracker. */
export function summarizeStatus(status: string): {
  status: OrderLifecycleStatus;
  label: string;
  step: number;
  terminal: boolean;
  next: OrderLifecycleStatus[];
} {
  const canonical = legacyToCanonical(status);
  return {
    status: canonical,
    label: ORDER_LABELS[canonical],
    step: stepIndex(status),
    terminal: isTerminal(status),
    next: nextStatuses(canonical),
  };
}