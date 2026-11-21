"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CreditCard,
  LoaderCircle,
  Lock,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import { cn, formatINR } from "@/lib/domain";
import { useOrderPayment, type PaymentTarget, type PayPhase } from "@/lib/razorpay-checkout";

const ease = [0.22, 1, 0.36, 1] as const;

/**
 * Payment step for an order that already exists and is awaiting payment.
 *
 * The overlay never invents an outcome: every state it shows is derived from
 * what the server confirmed. "Paid" appears only after /pay/verify (or the
 * capture webhook) says the payment is captured, and a closed Razorpay window is
 * reported as "cancelled" rather than quietly retried.
 */
export function PaymentStage({
  target,
  onPaid,
  onViewOrder,
  onAbandon,
  onClose,
}: {
  target: PaymentTarget | null;
  /** Payment confirmed captured server-side. */
  onPaid: () => void;
  /**
   * Just leave the stage. Deliberately separate from `onPaid` so a customer
   * who gives up waiting on a still-confirming bank transfer can reach their
   * order without anyone recording a payment that never happened.
   */
  onViewOrder: () => void;
  /** Customer chose not to finish; the order stays awaiting payment. */
  onAbandon: () => void;
  onClose: () => void;
}) {
  const { phase, error, busy, begin, reopen } = useOrderPayment(target);

  // Kick off checkout as soon as an unpaid order is handed to the stage.
  useEffect(() => {
    if (phase !== "starting" || !target) return;
    void begin();
  }, [phase, target, begin]);

  // Escape closes the stage only while the provider window is not open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "starting" || phase === "failed" || phase === "cancelled" || phase === "confirming") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  if (typeof document === "undefined" || !target) return null;

  const amount = formatINR(target.amountCents);

  return createPortal(
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-void">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4 border-b border-white/8 pb-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-xl border border-white/12 bg-white/5 text-cream-200">
              <Lock className="size-3.5" />
            </span>
            <div>
              <p className="font-display text-sm font-bold text-cream-50">Secure payment</p>
              <p className="text-[11px] text-cream-500">
                Order <span className="font-mono text-cream-200">{target.code}</span> · {target.payeeName}
              </p>
            </div>
          </div>
          {phase !== "verifying" && phase !== "opening" && phase !== "paid" && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close payment"
              className="press grid size-9 place-items-center rounded-full border border-white/10 text-cream-400 transition-colors hover:border-white/25 hover:text-cream-50"
            >
              <X className="size-4" />
            </button>
          )}
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.45, ease }}
              className="w-full max-w-md text-center"
            >
              <StatusGlyph phase={phase} />

              <h2 className="mt-6 font-display text-2xl font-bold tracking-tight text-cream-50">
                {HEADLINE[phase]}
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-cream-400">
                {SUBLINE[phase]}
              </p>

              {error && phase !== "paid" && (
                <p className="mx-auto mt-4 max-w-sm rounded-2xl border border-chili-500/30 bg-chili-600/10 px-4 py-3 text-[13px] leading-relaxed text-chili-300">
                  {error}
                </p>
              )}

              <p className="mt-7 font-display text-4xl font-bold tabular-nums text-cream-50">
                {amount}
              </p>
              <p className="mt-1 text-xs text-cream-500">
                {target.mode === "dev"
                  ? "Test mode — no real money moves"
                  : phase === "refunded"
                    ? "Returned to your account"
                    : "Paid to " + target.payeeName}
              </p>

              <div className="mt-8 flex flex-col gap-2.5">
                {phase === "failed" && (
                  <StageButton primary onClick={() => { reopen(); void begin(); }}>
                    Try payment again
                  </StageButton>
                )}
                {phase === "cancelled" && (
                  <StageButton primary onClick={() => { reopen(); void begin(); }}>
                    Resume payment
                  </StageButton>
                )}
                {(phase === "failed" || phase === "cancelled" || phase === "confirming") && (
                  <StageButton onClick={onAbandon}>Keep order without paying</StageButton>
                )}
                {phase === "paid" && (
                  <StageButton primary onClick={onPaid}>
                    <Check className="size-4" strokeWidth={3} /> View order
                  </StageButton>
                )}
                {phase === "confirming" && (
                  <StageButton onClick={onViewOrder}>Go to order tracking</StageButton>
                )}
                {phase === "refunded" && (
                  <StageButton primary onClick={onViewOrder}>
                    View order
                  </StageButton>
                )}
              </div>

              {phase === "confirming" && (
                <p className="mt-3 text-[11px] leading-relaxed text-cream-500">
                  The order is saved and reserved. The kitchen only starts once the capture is confirmed.
                </p>
              )}

              {(phase === "starting" || phase === "opening" || phase === "verifying") && (
                <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-cream-500">
                  <ShieldCheck className="size-3.5 text-mint-400" />
                  Card and UPI details are entered on the provider&apos;s secure page
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>,
    document.body,
  );
}

const HEADLINE: Record<PayPhase, string> = {
  starting: "Preparing your payment",
  opening: "Opening secure checkout",
  verifying: "Confirming with your bank",
  confirming: "Almost there",
  paid: "Payment received",
  refunded: "Payment refunded",
  failed: "Payment didn't go through",
  cancelled: "Payment cancelled",
};

const SUBLINE: Record<PayPhase, string> = {
  starting: "Hold tight — we are loading a secure payment session.",
  opening: "Choose UPI, card, netbanking or any other method Razorpay offers.",
  verifying: "Checking the payment with the provider before we confirm anything.",
  confirming: "Your bank is still finalising the payment. This page updates itself.",
  paid: "Your order is on its way to the restaurant.",
  refunded: "This payment was captured and then returned to you. Your order was not charged.",
  failed: "Nothing was charged. You can try a different method.",
  cancelled: "No money was taken. Your order is still reserved for a few minutes.",
};

function StatusGlyph({ phase }: { phase: PayPhase }) {
  if (phase === "paid") {
    return (
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="mx-auto grid size-20 place-items-center rounded-full bg-mint-500/15 text-mint-400"
      >
        <Check className="size-9" strokeWidth={3} />
      </motion.span>
    );
  }
  if (phase === "refunded") {
    return (
      <span className="mx-auto grid size-20 place-items-center rounded-full bg-white/6 text-cream-200">
        <Undo2 className="size-8" />
      </span>
    );
  }
  if (phase === "failed") {
    return (
      <span className="mx-auto grid size-20 place-items-center rounded-full bg-chili-600/15 text-chili-300">
        <TriangleAlert className="size-9" />
      </span>
    );
  }
  if (phase === "cancelled") {
    return (
      <span className="mx-auto grid size-20 place-items-center rounded-full bg-white/6 text-cream-200">
        <CreditCard className="size-8" />
      </span>
    );
  }
  if (phase === "confirming") {
    return (
      <span className="mx-auto grid size-20 place-items-center rounded-full bg-ember-400/12 text-ember-300">
        <Wallet className="size-8" />
      </span>
    );
  }
  return (
    <span className="mx-auto grid size-20 place-items-center rounded-full bg-ember-400/12 text-ember-300">
      <LoaderCircle className="size-8 animate-spin-slow" />
    </span>
  );
}

function StageButton({
  children,
  primary,
  onClick,
}: {
  children: React.ReactNode;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold transition-all duration-200",
        primary
          ? "bg-gradient-to-b from-ember-400 to-chili-600 text-white shadow-glow hover:opacity-95"
          : "border border-white/10 text-cream-200 transition-colors hover:border-white/25 hover:text-cream-50",
      )}
    >
      {children}
    </button>
  );
}
