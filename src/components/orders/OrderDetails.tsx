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
    <section className="card-lift mt-6 overflow-hidden rounded-3xl border border-white/8 bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] sm:mt-8">
      <div className="border-b border-white/6 bg-white/5 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
            Order
          </h2>
          <div className="flex items-center gap-2">
            {/* PHASE 8 — source/channel the order was created through. */}
            <span
              title={`Order channel: ${order.source ?? "marketplace"}`}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white/70"
            >
              {(order.source ?? "marketplace").toUpperCase()}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white/70">
              {fulfillment === "pickup" ? "Pickup" : "Delivery"}
            </span>
            {/* PHASE 9 — contract payment state (PAID / PENDING / FAILED…). */}
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                payment.status === "paid" || payment.status === "refunded"
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-400"
                  : payment.status === "failed"
                    ? "border-rose-500/25 bg-rose-500/10 text-rose-400"
                    : "border-amber-400/25 bg-amber-400/10 text-amber-400"
              }`}
            >
              {payment.status.toUpperCase()}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white/70">
              {payment.method === "card" ? "Card" : "Cash"}
            </span>
            {order.scheduledFor && (
              <span
                title={new Date(order.scheduledFor).toLocaleString()}
                className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-sky-400"
              >
                Scheduled
              </span>
            )}
          </div>
        </div>
        <p className="mt-1 font-mono text-lg font-bold tracking-tight text-white">
          #{reference}
        </p>
        <Link
          href={`/restaurants/${restaurant.slug}`}
          className="mt-1 inline-block break-words text-sm font-semibold text-white/60 transition-colors hover:text-ember-400"
        >
          {restaurant.name}
        </Link>
      </div>

      <div className="px-4 py-4">
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 break-words text-white/65">
                <span className="font-semibold">{item.quantity} × </span>
                {item.name}
                {item.modifiers.length > 0 && (
                  <span className="block pl-2 text-xs text-white/40">
                    {item.modifiers.map((m) => m.modifierName).join(" • ")}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-white/60">
                {currency(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-white/6 pt-3 text-sm">
          <div className="flex justify-between text-white/60">
            <span>Subtotal</span>
            <span className="tabular-nums">{currency(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="mt-0.5 flex justify-between text-emerald-400">
              <span>Discount</span>
              <span className="tabular-nums">
                −{currency(totals.discount)}
              </span>
            </div>
          )}
          {totals.tax > 0 && (
            <div className="mt-0.5 flex justify-between text-white/60">
              <span>Tax</span>
              <span className="tabular-nums">{currency(totals.tax)}</span>
            </div>
          )}
          {totals.deliveryFee > 0 && (
            <div className="mt-0.5 flex justify-between text-white/60">
              <span>Delivery fee</span>
              <span className="tabular-nums">
                {currency(totals.deliveryFee)}
              </span>
            </div>
          )}
        </div>

        <div className="mt-3 flex justify-between border-t border-white/6 pt-3 text-base font-bold text-white">
          <span>Total</span>
          <span className="tabular-nums">{currency(totals.total)}</span>
        </div>

        {/* PHASE 10 — append-only audit trail (debugging/integration surface).
            Same chronological event list the restaurant POS sees. */}
        <details className="mt-4 border-t border-white/6 pt-3">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.2em] text-white/40 transition-colors hover:text-white/60">
            Order events
          </summary>
          <ol className="mt-2 space-y-1 font-mono text-xs">
            {order.events.map((e, idx) => (
              <li
                key={`${idx}-${e.type}`}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="min-w-0 flex-1 truncate uppercase tracking-wide text-white/70">
                  {e.type}
                </span>
                <span className="shrink-0 tabular-nums text-white/40">
                  {new Date(e.at).toLocaleTimeString("en-US", {
                    hour12: false,
                  })}
                </span>
              </li>
            ))}
          </ol>
        </details>
      </div>

      {review.eligible && (
        <div className="border-t border-white/6 border-emerald-400/15 bg-emerald-400/10 px-4 py-3">
          <p className="text-sm font-semibold text-emerald-400">
            Thanks, {order.customer.name}! How was {restaurant.name}?
          </p>
          <Link
            href={`/restaurants/${restaurant.slug}#reviews`}
            className="mt-1 inline-block text-sm font-semibold text-emerald-300 underline underline-offset-2"
          >
            Leave a review →
          </Link>
        </div>
      )}
    </section>
  );
}