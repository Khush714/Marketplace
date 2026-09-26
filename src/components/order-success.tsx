"use client";

import Link from "next/link";
import { CreditCard, MapPinned, ReceiptText, Sparkles } from "lucide-react";
import { AnimatedPrice, WordReveal, cssVars } from "@/components/motion-primitives";
import { cn, formatINR } from "@/lib/domain";
import type { PublicOrder } from "@/lib/order-public";

const SPARK_COLORS = [
  "var(--color-ember-400)",
  "var(--color-chili-500)",
  "var(--color-gold-400)",
  "var(--color-berry-400)",
  "var(--color-mint-400)",
];

/** Deterministic spark geometry — computed once, rendered as a radial burst. */
const SPARKS = Array.from({ length: 26 }, (_, i) => {
  const angle = (i / 26) * Math.PI * 2 + (i % 3) * 0.12;
  const distance = 62 + ((i * 37) % 64);
  return {
    sx: `${(Math.cos(angle) * distance).toFixed(1)}px`,
    sy: `${(Math.sin(angle) * distance * 0.92).toFixed(1)}px`,
    size: 4 + ((i * 13) % 5),
    color: SPARK_COLORS[i % SPARK_COLORS.length],
    delay: 420 + (i % 9) * 34,
    duration: 780 + ((i * 53) % 420),
  };
});

export function OrderSuccess({
  order,
  onResumePayment,
  resumingPayment,
}: {
  order: PublicOrder;
  /** Present only while the order is still awaiting an online payment. */
  onResumePayment?: () => void;
  resumingPayment?: boolean;
}) {
  // Only say "payment confirmed" when the server says the payment is captured.
  // A COD order is with the kitchen but unpaid; an unpaid online order is not
  // even with the kitchen yet, and claiming otherwise is the exact lie this
  // screen used to tell.
  const status = order.paymentStatus.toUpperCase();
  const paidOnline = order.paymentMethod.toUpperCase() !== "COD" && (status === "PAID" || status === "CAPTURED");
  const isCod = order.paymentMethod.toUpperCase() === "COD";
  const unpaidOnline = !isCod && !paidOnline && status !== "REFUNDED";

  const badge = paidOnline
    ? "Payment confirmed"
    : isCod
      ? "Pay the rider on arrival"
      : "Payment not completed";
  const blurb = paidOnline
    ? `${order.restaurantName} is firing up the kitchen for you right now.`
    : isCod
      ? `${order.restaurantName} is firing up the kitchen. Keep the exact amount ready for the rider.`
      : `We haven't taken any money yet. Finish the payment from your order page so the kitchen can start.`;

  return (
    <div className="relative mx-auto flex min-h-[72vh] max-w-lg flex-col items-center justify-center px-4 py-14 text-center">
      {/* animated seal + burst */}
      <div className="relative grid size-32 place-items-center">
        <span className="animate-ripple absolute inset-0 rounded-full border-2 border-mint-400/45" />
        <span className="animate-ripple absolute inset-0 rounded-full border-2 border-mint-400/30 [animation-delay:0.6s]" />

        {/* particle burst */}
        {SPARKS.map((s, i) => (
          <span
            key={i}
            aria-hidden
            className="animate-spark absolute left-1/2 top-1/2 rounded-full"
            style={cssVars({
              "--sx": s.sx,
              "--sy": s.sy,
              width: `${s.size}px`,
              height: `${s.size}px`,
              background: s.color,
              boxShadow: `0 0 8px 1px ${s.color}`,
              animationDelay: `${s.delay}ms`,
              animationDuration: `${s.duration}ms`,
            })}
          />
        ))}

        <span className="grid size-28 place-items-center rounded-full bg-gradient-to-b from-mint-400/25 to-mint-500/10 ring-1 ring-mint-400/40">
          <svg viewBox="0 0 64 64" className="size-16" aria-hidden>
            <circle
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke="var(--color-mint-400)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="164"
              strokeDashoffset="164"
              className="animate-circle-draw"
            />
            <path
              d="M21 33.5 28.5 41 44 24"
              fill="none"
              stroke="var(--color-mint-400)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="34"
              strokeDashoffset="34"
              className="animate-check-draw"
            />
          </svg>
        </span>
      </div>

      <p
        className={cn(
          "animate-rise mt-8 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.24em]",
          paidOnline || isCod ? "text-mint-400" : "text-ember-300",
        )}
        style={cssVars({ animationDelay: "0.5s" })}
      >
        <Sparkles className="size-3.5 animate-glow-breathe" /> {badge}
      </p>
      <h1
        className="animate-rise mt-2 font-display text-4xl font-bold tracking-tight text-cream-50 md:text-5xl"
        style={cssVars({ animationDelay: "0.62s" })}
      >
        <WordReveal text="Order placed" delay={620} step={70} />
        <span className="text-gradient">.</span>
      </h1>
      <p
        className="animate-rise mt-3 max-w-xs text-[15px] leading-relaxed text-cream-400"
        style={cssVars({ animationDelay: "0.74s" })}
      >
        {blurb}
      </p>

      <div className="animate-rise glass mt-7 flex w-full items-center justify-between gap-4 rounded-2xl px-5 py-4" style={cssVars({ animationDelay: "0.86s" })}>
        <span className="flex items-center gap-2 text-sm text-cream-400">
          <ReceiptText className="size-4 text-ember-400" />
          Order <span className="font-mono font-bold uppercase text-cream-50">{order.code}</span>
        </span>
        <AnimatedPrice cents={order.totalCents} className="text-sm font-bold text-cream-50" />
      </div>

      <div className="animate-rise mt-7 flex w-full flex-col gap-2.5 sm:flex-row" style={cssVars({ animationDelay: "0.98s" })}>
        {unpaidOnline && onResumePayment ? (
          <button
            type="button"
            onClick={onResumePayment}
            disabled={resumingPayment}
            className="press group relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3.5 text-sm font-bold text-white shadow-glow disabled:opacity-60"
          >
            <span
              aria-hidden
              className="sheen-band absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:animate-sheen group-hover:opacity-100"
            />
            <CreditCard className="relative size-4.5" />
            {resumingPayment ? "Starting…" : `Pay ${formatINR(order.totalCents)} now`}
          </button>
        ) : (
          <Link
            href={`/order/${order.code}/track`}
            className="press group relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-ember-400 to-chili-600 py-3.5 text-sm font-bold text-white shadow-glow"
          >
            <span
              aria-hidden
              className="sheen-band absolute inset-y-0 -left-1/3 w-1/3 opacity-0 group-hover:animate-sheen group-hover:opacity-100"
            />
            <MapPinned className="relative size-4.5" /> Track your order
          </Link>
        )}
        <Link
          href="/"
          className="press flex flex-1 items-center justify-center rounded-2xl bg-white/8 py-3.5 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
        >
          Back to discovery
        </Link>
      </div>

      <p className="animate-fade-in mt-6 text-xs text-cream-600" style={cssVars({ animationDelay: "1.2s" })}>
        Live tracking begins in a few seconds
      </p>
    </div>
  );
}

