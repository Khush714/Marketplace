/**
 * PHASE 13 — a single consistent order lifecycle shared by the POS and the
 * marketplace. The marketplace ONLY renders what the POS says; it never invents
 * a parallel state machine.
 *
 *   placed → accepted → preparing → ready → completed
 *   placed → cancelled
 *
 * Transitions are enforced server-side. Historical order rows using the old
 * ad-hoc states (pending/confirmed/out_for_delivery/delivered) are mapped at
 * read time onto the canonical lifecycle so nothing is lost.
 */

export type OrderLifecycleStatus =
  | "placed"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export const ORDER_STATUSES: OrderLifecycleStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
];

export const ORDER_LABELS: Record<OrderLifecycleStatus, string> = {
  placed: "Order placed",
  accepted: "Restaurant accepted",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Canonical read-path label (used by the customer app). */
export function statusLabel(status: string): string {
  const canonical = legacyToCanonical(status);
  switch (canonical) {
    case "placed":
      return "Order placed";
    case "accepted":
      return "Restaurant accepted";
    case "preparing":
      return "Preparing";
    case "ready":
      return "Ready";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

/** Whether the status is a "live" (non-terminal) state. */
export function isTerminal(status: string): boolean {
  const s = legacyToCanonical(status);
  return s === "completed" || s === "cancelled";
}

/**
 * Map legacy / ad-hoc statuses onto the canonical lifecycle. Keeps old rows
 * (pending, confirmed, out_for_delivery, delivered) meaningful after this
 * phase ships.
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
    case "completed":
    case "delivered":
    case "out_for_delivery":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "placed";
  }
}

/** Forward (canonical) step used by the customer progress tracker. */
export function stepIndex(status: string): number {
  const flow: OrderLifecycleStatus[] = [
    "placed",
    "accepted",
    "preparing",
    "ready",
    "completed",
  ];
  const idx = flow.indexOf(legacyToCanonical(status));
  return idx === -1 ? 0 : idx;
}

const TRANSITIONS: Record<OrderLifecycleStatus, OrderLifecycleStatus[]> = {
  placed: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
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
