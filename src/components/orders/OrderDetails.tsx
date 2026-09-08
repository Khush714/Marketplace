"use client";

import Link from "next/link";
import { currency } from "@/lib/format";
import type { PublicOrder } from "@/lib/marketplace";

/**
 * PHASE 16 — static order snapshot (contents + totals).
 *
 *   Order
 *   #MKT-AB12CD
 *   2 × Escargots              $19.00
 *   1 × French Onion Soup        $8.00
 *   ────────────────────────────────
 *   Subtotal                   $27.00
 *   Tax                         $1.75
 *   ────────────────────────────────
 *   Total                      $28.75
 *
 * The order line amount (unitPrice × quantity) is display math over two
 * API-provided values; every other figure (subtotal, discount, tax, delivery
 * fee, total) is read verbatim from `order.totals` — the backend remains the
 * financial source of truth and no new pricing logic exists here.
 */
export function OrderDetails({ order }: { order: PublicOrder }) {
  const { reference, restaurant, totals, items, fulfillment, payment, review } =
    order;

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:mt-8">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            Order
          </h2>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">
              {fulfillment === "pickup" ? "Pickup" : "Delivery"}
            </span>
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">
              {payment.method === "card" ? "Card" : "Cash"}
            </span>
          </div>
        </div>
        <p className="mt-1 font-mono text-lg font-bold tracking-tight text-slate-900">
          #{reference}
        </p>
        <Link
          href={`/restaurants/${restaurant.slug}`}
          className="mt-1 inline-block text-sm font-semibold text-slate-600 hover:text-orange-600"
        >
          {restaurant.name}
        </Link>
      </div>

      <div className="px-4 py-4">
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 text-sm">
              <span className="text-slate-700">
                <span className="font-semibold">{item.quantity} × </span>
                {item.name}
                {item.modifiers.length > 0 && (
                  <span className="block pl-2 text-xs text-slate-400">
                    {item.modifiers.map((m) => m.modifierName).join(" • ")}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {currency(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span className="tabular-nums">{currency(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="mt-0.5 flex justify-between text-emerald-700">
              <span>Discount</span>
              <span className="tabular-nums">
                −{currency(totals.discount)}
              </span>
            </div>
          )}
          {totals.tax > 0 && (
            <div className="mt-0.5 flex justify-between text-slate-600">
              <span>Tax</span>
              <span className="tabular-nums">{currency(totals.tax)}</span>
            </div>
          )}
          {totals.deliveryFee > 0 && (
            <div className="mt-0.5 flex justify-between text-slate-600">
              <span>Delivery fee</span>
              <span className="tabular-nums">
                {currency(totals.deliveryFee)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
          <span>Total</span>
          <span className="tabular-nums">{currency(totals.total)}</span>
        </div>
      </div>

      {review.eligible && (
        <div className="border-t border-slate-100 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-700">
            Thanks, {order.customer.name}! How was {restaurant.name}?
          </p>
          <Link
            href={`/restaurants/${restaurant.slug}#reviews`}
            className="mt-1 inline-block text-sm font-semibold text-emerald-800 underline underline-offset-2"
          >
            Leave a review →
          </Link>
        </div>
      )}
    </section>
  );
}