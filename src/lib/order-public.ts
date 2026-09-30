import type { OrderDto } from "@/lib/types";

/**
 * The one customer-safe projection of an order (Phase 7 hygiene).
 *
 * `OrderDto` is the internal row shape: it carries the numeric order id, the
 * numeric restaurant id, the POS `externalOrderId`, and the customer's phone.
 * None of those belong in a browser payload, so every customer-facing route
 * (tracking, history, success) projects through {@link toPublicOrder} instead
 * of serialising the DTO directly.
 */
export type PublicOrder = Pick<
  OrderDto,
  | "code"
  | "restaurantSlug"
  | "restaurantName"
  | "items"
  | "addressLabel"
  | "addressText"
  | "customerName"
  | "instructions"
  | "riderName"
  | "paymentMethod"
  | "paymentStatus"
  | "posDeliveryStatus"
  | "subtotalCents"
  | "deliveryFeeCents"
  | "platformFeeCents"
  | "discountCents"
  | "totalCents"
  | "createdAt"
  | "status"
>;

/**
 * `posDeliveryStatus` is included deliberately: it is the only signal the
 * customer has that the order never reached the kitchen, and hiding it would
 * leave a charged order displaying a confident but fictional courier. It
 * carries no internal identifiers, so it is safe on the public projection.
 * `posConnected` is NOT — it only distinguishes which tracking timeline the
 * view should draw and has no meaning for the customer.
 */
export function toPublicOrder(o: OrderDto): PublicOrder {
  return {
    code: o.code,
    restaurantSlug: o.restaurantSlug,
    restaurantName: o.restaurantName,
    items: o.items,
    addressLabel: o.addressLabel,
    addressText: o.addressText,
    customerName: o.customerName,
    instructions: o.instructions,
    riderName: o.riderName,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    posDeliveryStatus: o.posDeliveryStatus,
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    platformFeeCents: o.platformFeeCents,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    createdAt: o.createdAt,
    status: o.status,
  };
}

/**
 * Stages an order can never leave. `delivered` is *not* sufficient on its own:
 * the POS lifecycle (see INTEGRATION_TRACKING_STAGES in db/queries) marks both
 * CANCELLED and REJECTED as `delivered: false`, because they are not deliveries.
 * So `!status.delivered` reports a cancelled order as still moving — which is
 * how the orders list ended up offering "Track live" with a pulsing dot on a
 * cancelled order, and how the poller would never have known to stop.
 */
const TERMINAL_STAGE_KEYS: ReadonlySet<string> = new Set(["delivered", "cancelled", "rejected"]);

/**
 * Whether this order can still change, and therefore whether it is worth asking
 * the server about again.
 *
 * Single source of truth for that question. The tracking view derives its own
 * `settled` / `neverDelivered` for copy and colour, but its notion of "in flight"
 * comes from here, so a poller and the UI cannot disagree about whether an order
 * is finished.
 *
 * The `posDeliveryStatus === "FAILED"` arm is the "never reached the kitchen"
 * case. The order is closed for delivery purposes, so there is no courier to
 * track and no stage to advance — only a refund to settle, which the customer
 * does not need re-rendered at 4-second intervals to learn about.
 */
export function isOrderLive(order: Pick<PublicOrder, "status" | "posDeliveryStatus">): boolean {
  if (order.status.delivered) return false;
  if (TERMINAL_STAGE_KEYS.has(order.status.stageKey)) return false;
  if (order.posDeliveryStatus === "FAILED") return false;
  return true;
}
