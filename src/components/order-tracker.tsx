"use client";

import Link from "next/link";
import { useProfile } from "@/lib/profile";
import { usePublicOrder } from "@/lib/order-access";
import { TrackingView } from "@/components/tracking-view";

/**
 * Client entry for /order/[code]/track. The order is read through the token this
 * browser was issued at checkout, so the page itself never has to be trusted
 * with an unauthenticated read.
 */
export function OrderTracker({ code }: { code: string }) {
  const { hydrated } = useProfile();
  const { order, access, token } = usePublicOrder(code);

  if (!hydrated || access === "loading" || (access === "ready" && order && !token)) {
    return <Skeleton />;
  }

  if (access === "denied" || !order || !token) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-cream-50">We can&apos;t open this order</h1>
        <p className="mt-2 text-sm leading-relaxed text-cream-400">
          Order links only work in the browser that placed them, because the access key is stored
          there. If you placed this order on another device, contact support with the order code.
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

  return <TrackingView initialOrder={order} token={token} />;
}

function Skeleton() {
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
