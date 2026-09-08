"use client";

import type { PublicOrder } from "@/lib/marketplace";

/**
 * PHASE 18 — order-type-specific information, driven by the existing
 * order-type field (`order.fulfillment`, from `orders.fulfillment_type`).
 * Rendered dynamically on the single /orders/[reference] page — no separate
 * tracking pages.
 *
 *   DINE-IN
 *   Table 12
 *
 *   TAKEAWAY
 *   Pickup from restaurant
 *
 *   DELIVERY
 *   Delivering to your address
 *
 * `dine_in` is not yet emitted by the (frozen) ordering API, but the branch is
 * present so a future dine-in order renders correctly with zero frontend
 * changes. Nothing here re-creates tracking logic — it is presentation only.
 */
type OrderType = "dine_in" | "delivery" | "pickup";

const TYPE_STYLES: Record<OrderType, { accent: string; dot: string }> = {
  dine_in: { accent: "text-indigo-600", dot: "bg-indigo-500" },
  delivery: { accent: "text-sky-600", dot: "bg-sky-500" },
  pickup: { accent: "text-orange-600", dot: "bg-orange-500" },
};

export function OrderTypeInfo({ order }: { order: PublicOrder }) {
  const fulfillment: string = order.fulfillment;
  const address = order.customer.address.trim();

  let type: OrderType;
  let label: string;
  let detail: string;

  if (fulfillment === "dine_in" || fulfillment === "dine-in") {
    type = "dine_in";
    label = "Dine-in";
    detail = address ? `Table ${address}` : "Served at your table";
  } else if (fulfillment === "delivery") {
    type = "delivery";
    label = "Delivery";
    detail = address
      ? `Delivering to: ${address}`
      : "Delivering to your address";
  } else {
    type = "pickup";
    label = "Takeaway";
    detail = "Pickup from restaurant";
  }

  const style = TYPE_STYLES[type];

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`}
        />
        <p
          className={`text-base font-bold uppercase tracking-[0.15em] ${style.accent}`}
        >
          {label}
        </p>
      </div>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </section>
  );
}