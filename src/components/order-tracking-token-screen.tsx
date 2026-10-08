"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrackingView } from "@/components/tracking-view";
import { fetchOrderByTrackingToken } from "@/lib/order-access";
import { useProfileOrders, useProfileReady } from "@/lib/profile";
import type { PublicOrder } from "@/lib/order-public";

/**
 * Client entry for /order/track/[trackingToken] — the shareable tracking URL.
 *
 * The tracking token is the credential, so the order can be read straight from
 * the API with no per-browser header. Cancellation is a separate, higher bar:
 * it stays bound to the HMAC token minted at checkout, so only a browser that
 * actually placed this order (and still holds the code+token pair) is offered
 * the cancel button — a link forwarded to a delivery helper or a second device
 * can track, but cannot change the order.
 */
export function OrderTrackingTokenScreen({ trackingToken }: { trackingToken: string }) {
  const hydrated = useProfileReady();
  const { orders } = useProfileOrders();
  // The router only ever mounts this screen for a real [trackingToken] segment,
  // so the empty-token case is a formality: it resolves straight to the
  // "can't open" state instead of parking on a spinner with no fetch pending.
  const [order, setOrder] = useState<PublicOrder | null | "loading">(
    trackingToken ? "loading" : null,
  );

  useEffect(() => {
    if (!trackingToken) return;
    let cancelled = false;
    fetchOrderByTrackingToken(trackingToken)
      .then((found) => {
        if (!cancelled) setOrder(found);
      })
      .catch(() => {
        if (!cancelled) setOrder(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trackingToken]);

  if (order === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-9 md:px-6">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton mt-3 h-10 w-72" />
        <div className="mt-7 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="skeleton h-[420px] rounded-[28px] lg:min-h-[560px]" />
          <div className="space-y-6">
            <div className="skeleton h-72 rounded-3xl" />
            <div className="skeleton h-64 rounded-3xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-cream-50">We can&apos;t open this order</h1>
        <p className="mt-2 text-sm leading-relaxed text-cream-400">
          This tracking link doesn&apos;t match an order on file. Links include a secret
          access token, so a copied or mistyped URL goes nowhere.
        </p>
        <Link
          href="/"
          className="press mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
        >
          Back to discovery
        </Link>
      </div>
    );
  }

  // Cancellation still needs the HMAC token this browser was minted at checkout.
  // It is only present when this browser actually placed the order; a shared
  // link on another device sees a read-only tracker.
  const placedHere = hydrated ? orders.find((o) => o.code === order.code)?.token ?? "" : "";

  return <TrackingView initialOrder={order} token={placedHere || undefined} trackingToken={trackingToken} />;
}