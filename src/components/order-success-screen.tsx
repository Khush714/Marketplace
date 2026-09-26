"use client";

import Link from "next/link";
import { useState } from "react";
import { OrderSuccess } from "@/components/order-success";
import { PaymentStage } from "@/components/payment-stage";
import { useProfile } from "@/lib/profile";
import { usePublicOrder } from "@/lib/order-access";
import type { PaymentTarget, ProviderMode } from "@/lib/razorpay-checkout";

/** Client entry for /order/[code]/success — token-gated like tracking. */
export function OrderSuccessScreen({ code }: { code: string }) {
  const { hydrated } = useProfile();
  const { order, access, token, refresh } = usePublicOrder(code);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (!hydrated || access === "loading" || (access === "ready" && !order)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <div className="skeleton mx-auto size-28 rounded-full" />
        <div className="skeleton mx-auto mt-8 h-9 w-64" />
        <div className="skeleton mx-auto mt-4 h-5 w-80" />
      </div>
    );
  }

  if (access === "denied" || !order || !token) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-cream-50">We can&apos;t open this order</h1>
        <p className="mt-2 text-sm leading-relaxed text-cream-400">
          This order was placed in a different browser, so the key needed to read it isn&apos;t here.
        </p>
        <p className="mt-4 font-mono text-sm text-cream-500">{code}</p>
        <Link
          href="/orders"
          className="press mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
        >
          See your orders
        </Link>
      </div>
    );
  }

  const status = order.paymentStatus.toUpperCase();
  const isCod = order.paymentMethod.toUpperCase() === "COD";
  const unpaidOnline = !isCod && status !== "PAID" && status !== "CAPTURED" && status !== "REFUNDED";

  /**
   * The order already exists and is held at PAYMENT_PENDING, so resuming is
   * just re-reading its (idempotent) payment session — never a second order.
   */
  const resumePayment = async () => {
    setStarting(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(code)}/pay/start`, {
        method: "POST",
        headers: { "x-order-token": token, "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        reference?: string;
        providerOrderId?: string | null;
        keyId?: string | null;
        amountCents?: number;
        currency?: string;
        mode?: ProviderMode;
      } | null;
      if (!res.ok || !data?.ok || !data.providerOrderId) {
        setPayError(data?.error ?? "Could not start the payment. Please try again.");
        return;
      }
      setPayTarget({
        code,
        token,
        reference: data.reference ?? "",
        providerOrderId: data.providerOrderId,
        keyId: data.keyId ?? null,
        amountCents: data.amountCents ?? order.totalCents,
        currency: data.currency ?? "INR",
        mode: data.mode ?? "unavailable",
        payeeName: order.restaurantName || "crave.",
        customerName: order.customerName,
        phone: "",
      });
    } catch {
      setPayError("Could not start the payment. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      {payError && (
        <p className="mx-auto mt-6 max-w-lg rounded-2xl border border-chili-500/30 bg-chili-600/10 px-4 py-3 text-center text-[13px] text-chili-300">
          {payError}
        </p>
      )}
      <OrderSuccess
        order={order}
        onResumePayment={unpaidOnline ? resumePayment : undefined}
        resumingPayment={starting}
      />
      {payTarget && (
        <PaymentStage
          target={payTarget}
          onPaid={() => {
            setPayTarget(null);
            void refresh();
          }}
          // Leaving without a confirmed capture is a navigation only — the
          // order keeps whatever status the server actually holds.
          onViewOrder={() => setPayTarget(null)}
          onAbandon={() => setPayTarget(null)}
          onClose={() => setPayTarget(null)}
        />
      )}
    </>
  );
}
