"use client";

import type { PublicOrder } from "@/lib/marketplace";
import {
  DELIVERY_MAINLINE,
  DELIVERY_LABELS,
  deliveryStep,
} from "@/lib/delivery-status";

/**
 * PHASE 29+45 — the rider panel on the customer tracker. Shown only for delivery
 * orders with an active assignment (`order.delivery` non-null). Renders the
 * partner identity plus the full 8-step delivery rail:
 *
 *   pending → assigned → accepted → at_restaurant → picked_up
 *          → out_for_delivery → arriving → delivered
 *
 * Step position comes from the API snapshot (`delivery.step`), which is
 * computed by the canonical `deliveryStep()` in delivery-status.ts.
 *
 * The rail renders only the "action" sub-range (assigned → arriving) to keep
 * the UI compact, with a leading pending indicator when waiting, and a
 * trailing delivered state.
 */
export function DeliveryTracker({
  delivery,
}: {
  delivery: NonNullable<PublicOrder["delivery"]>;
}) {
  const delivered = delivery.step >= DELIVERY_MAINLINE.length;

  // Show the compact rail: pending dot + 5 core steps + delivered
  // This covers the visually meaningful progression without overwhelming the user.
  const RAIL_STEPS = [
    "pending",
    "assigned",
    "accepted",
    "at_restaurant",
    "picked_up",
    "out_for_delivery",
    "arriving",
  ] as const;

  return (
    <section className="card-lift mt-4 rounded-3xl border border-white/8 bg-ink-850 px-5 py-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${
              delivered ? "bg-emerald-400" : "bg-sky-400"
            }`}
          />
          <p className="text-base font-bold uppercase tracking-[0.15em] text-sky-400">
            Delivery
          </p>
        </div>
        {delivery.partner && (
          <span className="shrink truncate max-w-[45%] rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/70">
            {delivery.partner.name}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm font-semibold text-white">
        {delivery.label}
      </p>

      {delivery.partner && (
        <p className="mt-0.5 text-xs text-white/45">
          {delivery.partner.name} · {delivery.partner.vehicleType}
        </p>
      )}

      {/* Rider progress rail — canonical 8-step delivery lifecycle */}
      {!delivered && (
        <div className="mt-4 flex items-center gap-1">
          {RAIL_STEPS.map((s, i) => {
            const stepIdx = deliveryStep(s);
            const currentIdx = delivery.step;
            const done = stepIdx < currentIdx;
            const isActive = stepIdx === currentIdx;
            return (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <span
                  className={`relative grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-bold transition-colors duration-300 ${
                    done
                      ? "bg-sky-500 text-ink-950"
                      : isActive
                        ? "bg-sky-500/15 text-sky-400 ring-2 ring-sky-500"
                        : "border border-white/15 bg-ink-850 text-white/40"
                  }`}
                >
                  {done ? "✓" : isActive ? "●" : "○"}
                </span>
                {i < RAIL_STEPS.length - 1 && (
                  <span
                    className={`mx-1 h-0.5 min-w-0 flex-1 rounded ${
                      done ? "bg-sky-500" : "bg-white/10"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delivered final state */}
      {delivered && (
        <div className="mt-4 flex items-center gap-1">
          {RAIL_STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center last:flex-none">
              <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400 text-[9px] font-bold text-ink-950">
                ✓
              </span>
              {i < RAIL_STEPS.length - 1 && (
                <span className="mx-1 h-0.5 min-w-0 flex-1 rounded bg-emerald-400" />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
