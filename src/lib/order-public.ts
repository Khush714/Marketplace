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
  | "subtotalCents"
  | "deliveryFeeCents"
  | "platformFeeCents"
  | "discountCents"
  | "totalCents"
  | "createdAt"
  | "status"
>;

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
    subtotalCents: o.subtotalCents,
    deliveryFeeCents: o.deliveryFeeCents,
    platformFeeCents: o.platformFeeCents,
    discountCents: o.discountCents,
    totalCents: o.totalCents,
    createdAt: o.createdAt,
    status: o.status,
  };
}
