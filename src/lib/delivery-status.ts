/**
 * PHASE 45 — canonical DELIVERY lifecycle. This file is the CONTRACT for the
 * delivery track, exactly like src/lib/order-lifecycle.ts is for the kitchen
 * track — the delivery engine, the customer tracker and the rider app must
 * never re-implement these rules.
 *
 * The two lifecycles are deliberately DECOUPLED:
 *
 *   FOOD (orders.status — POS-driven)
 *     placed → accepted → preparing → ready
 *
 *   DELIVERY (delivery_orders.delivery_status)
 *     pending → assigned → accepted → at_restaurant → picked_up
 *            → out_for_delivery → arriving → delivered
 *     plus failed / cancelled edges at (almost) any live state.
 *
 * `delivery_orders.delivery_status` is the authoritative delivery track. It
 * runs in parallel to the kitchen states a restaurant POS drives, so the
 * kitchen flow is never polluted with rider states.
 *
 * Wire/DB keys are lowercase and stable. Historical PHASE 29 ad-hoc values
 * (accepted/arriving/picked_up/…) are mapped at read time onto this lifecycle
 * (`deliveryStatusCanonical`) so nothing is lost.
 */

export type DeliveryStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "at_restaurant"
  | "picked_up"
  | "out_for_delivery"
  | "arriving"
  | "delivered"
  | "failed"
  | "cancelled";

/** Every canonical state the delivery track can hold (wire contract). */
export const DELIVERY_STATUSES: DeliveryStatus[] = [
  "pending",
  "assigned",
  "accepted",
  "at_restaurant",
  "picked_up",
  "out_for_delivery",
  "arriving",
  "delivered",
  "failed",
  "cancelled",
];

/**
 * The forward mainline. Rails, steppers and the admin single-step UI consume
 * THIS array so a lifecycle change only ever lands in one place. `failed` and
 * `cancelled` are terminal off-rail states.
 */
export const DELIVERY_MAINLINE: DeliveryStatus[] = [
  "pending",
  "assigned",
  "accepted",
  "at_restaurant",
  "picked_up",
  "out_for_delivery",
  "arriving",
  "delivered",
];

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  pending: "Waiting for a driver",
  assigned: "Driver assigned",
  accepted: "Driver on the way",
  at_restaurant: "Driver at restaurant",
  picked_up: "Order picked up",
  out_for_delivery: "Out for delivery",
  arriving: "Arriving soon",
  delivered: "Delivered",
  failed: "Delivery failed",
  cancelled: "Delivery cancelled",
};

/** Uppercase contract keys for status chips (DELIVERED, OUT FOR DELIVERY …). */
export const DELIVERY_CONTRACT: Record<DeliveryStatus, string> = {
  pending: "PENDING",
  assigned: "ASSIGNED",
  accepted: "ACCEPTED",
  at_restaurant: "AT RESTAURANT",
  picked_up: "PICKED UP",
  out_for_delivery: "OUT FOR DELIVERY",
  arriving: "ARRIVING",
  delivered: "DELIVERED",
  failed: "FAILED",
  cancelled: "CANCELLED",
};

/**
 * Map legacy / ad-hoc PHASE 29 delivery values onto the canonical lifecycle.
 * `arriving` (old "Arriving at restaurant") is the same physical moment as
 * `at_restaurant`. Old rows stay meaningful after this phase ships.
 */
const LEGACY_TO_CANONICAL: Record<string, DeliveryStatus> = {
  assigned: "assigned",
  accepted: "accepted",
  arriving: "at_restaurant",
  picked_up: "picked_up",
  delivered: "delivered",
  cancelled: "cancelled",
};

export function deliveryStatusCanonical(status: string): DeliveryStatus {
  if ((DELIVERY_STATUSES as string[]).includes(status)) {
    return status as DeliveryStatus;
  }
  return LEGACY_TO_CANONICAL[status] ?? "pending";
}

const TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["assigned", "cancelled", "failed"],
  assigned: ["accepted", "at_restaurant", "cancelled", "failed"],
  accepted: ["at_restaurant", "cancelled", "failed"],
  at_restaurant: ["picked_up", "cancelled", "failed"],
  picked_up: ["out_for_delivery", "failed"],
  out_for_delivery: ["arriving", "failed"],
  arriving: ["delivered", "failed"],
  delivered: [],
  failed: [],
  cancelled: [],
};

export function canDeliveryTransition(
  fromRaw: string,
  toRaw: string,
): boolean {
  const from = deliveryStatusCanonical(fromRaw);
  const to = deliveryStatusCanonical(toRaw);
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextDeliveryStatuses(
  current: DeliveryStatus,
): DeliveryStatus[] {
  return TRANSITIONS[current] ?? [];
}

/** Complete forward-rail rules are one place (see doc above). */
export function deliveryStep(status: string): number {
  const idx = DELIVERY_MAINLINE.indexOf(deliveryStatusCanonical(status));
  return idx === -1 ? 0 : idx;
}

/** True when the delivery value is a terminal state. */
export function isDeliveryTerminal(status: string): boolean {
  const s = deliveryStatusCanonical(status);
  return s === "delivered" || s === "failed" || s === "cancelled";
}

/**
 * The single next step on the forward mainline — for single-stepper UX (the
 * admin dispatch queue). Returns null when terminal or at the final mainline
 * step.
 */
export function nextDeliveryMainlineStep(
  status: string,
): DeliveryStatus | null {
  const s = deliveryStatusCanonical(status);
  if (isDeliveryTerminal(s)) return null;
  const idx = DELIVERY_MAINLINE.indexOf(s);
  if (idx === -1 || idx >= DELIVERY_MAINLINE.length - 1) return null;
  return DELIVERY_MAINLINE[idx + 1];
}

/** Summary shape for the customer tracker / rider app / admin queue. */
export function summarizeDeliveryStatus(status: string): {
  status: DeliveryStatus;
  label: string;
  contract: string;
  step: number;
  terminal: boolean;
  next: DeliveryStatus[];
} {
  const canonical = deliveryStatusCanonical(status);
  return {
    status: canonical,
    label: DELIVERY_LABELS[canonical],
    contract: DELIVERY_CONTRACT[canonical],
    step: deliveryStep(canonical),
    terminal: isDeliveryTerminal(canonical),
    next: nextDeliveryStatuses(canonical),
  };
}