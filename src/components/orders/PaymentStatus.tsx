"use client";

import { currency } from "@/lib/format";
import type { PublicOrder } from "@/lib/marketplace";

/**
 * PHASE 17 — payment status, kept deliberately separate from the order
 * lifecycle (an order can be delivered while a card capture is still pending,
 * or paid while preparing). The label is derived from the backend's
 * `payment.status` value; the amount is the backend's total. No payment logic
 * lives here.
 */
type PaymentTone = "ok" | "pending" | "fail";

const PAYMENT_STATES: Record<string, { label: string; tone: PaymentTone }> = {
  paid: { label: "Payment successful", tone: "ok" },
  pending: { label: "Payment pending", tone: "pending" },
  unpaid: { label: "Payment pending", tone: "pending" },
  failed: { label: "Payment failed", tone: "fail" },
  refunded: { label: "Refunded", tone: "ok" },
};

export function PaymentStatus({
  payment,
  total,
}: {
  payment: PublicOrder["payment"];
  total: number;
}) {
  const state =
    PAYMENT_STATES[payment.status] ??
    ({ label: "Payment pending", tone: "pending" } as const);

  return (
    <section className="card-lift mt-4 overflow-hidden rounded-3xl border border-white/8 bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      <div className="border-b border-white/6 bg-white/5 px-4 py-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
          Payment
        </h2>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-2.5">
          {state.tone === "ok" && (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-[11px] font-bold text-ink-950">
              ✓
            </span>
          )}
          {state.tone === "pending" && (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
            </span>
          )}
          {state.tone === "fail" && (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-500 text-[11px] font-bold text-ink-950">
              ✕
            </span>
          )}
          <p
            className={`text-sm font-semibold ${
              state.tone === "ok"
                ? "text-emerald-400"
                : state.tone === "fail"
                  ? "text-rose-400"
                  : "text-amber-400"
            }`}
          >
            {state.label}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold tabular-nums text-white">
            {currency(total)}
          </p>
          <p className="text-xs capitalize text-white/40">
            {payment.method === "card" ? "Card" : "Cash"}
          </p>
        </div>
      </div>
    </section>
  );
}