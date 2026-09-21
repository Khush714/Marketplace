"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import PaymentApp from "@/payment/App";
import type { Channel, OrderLine, Phase } from "@/payment/lib/checkout";

export type SettleResult = { phase: Phase; channel: Channel };

export function PaymentStage({
  amountCents,
  payee,
  lines,
  redirect,
  onSettled,
  onViewOrder,
  onClose,
}: {
  amountCents: number;
  payee: string;
  lines: OrderLine[];
  /** When a real order has been placed: show the countdown + VIEW ORDER. */
  redirect?: { code: string; in: number } | null;
  onSettled: (result: SettleResult) => void;
  onViewOrder?: () => void;
  onClose: () => void;
}) {
  const lineItems = useMemo(() => lines, [lines]);

  // lock page scroll while the payment stage is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-void">
      <PaymentApp
        amountCents={amountCents}
        payee={payee}
        lines={lineItems}
        simulation={false}
        redirect={redirect}
        onSettled={onSettled}
        onViewOrder={onViewOrder}
        onExit={onClose}
      />
      {!redirect && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to checkout"
          className="press fixed bottom-5 left-1/2 z-[95] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/55 px-5 py-2.5 text-[11px] tracking-[0.22em] text-white/65 backdrop-blur-md transition-colors hover:border-white/25 hover:text-white"
        >
          <ArrowLeft className="size-3.5" /> BACK TO CHECKOUT
        </button>
      )}
    </div>,
    document.body,
  );
}