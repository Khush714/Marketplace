"use client";

import Link from "next/link";
import { useProfileReady } from "@/lib/profile";
import { usePublicOrder } from "@/lib/order-access";
import { TrackingView } from "@/components/tracking-view";

/**
 * Client entry for /order/[code]/track. The order is read with the HMAC token
 * this browser was issued at checkout, or — once web storage has been cleared —
 * with the HttpOnly session cookie. The server authorises either one; the page
 * never performs an unauthenticated read.
 */
export function OrderTracker({ code }: { code: string }) {
  const hydrated = useProfileReady();
  const { order, access, token } = usePublicOrder(code);

  if (!hydrated || access === "loading") {
    return <Skeleton />;
  }

  if (access === "denied" || !order) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-cream-50">We can&apos;t open this order</h1>
        <p className="mt-2 text-sm leading-relaxed text-cream-400">
          This link only works in a browser that placed the order or still holds its session. If
          you placed it on another device, contact support with the order code.
        </p>
        <p className="mt-4 font-mono text-sm text-cream-500">{code}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={`/contact?order=${encodeURIComponent(code)}`}
            className="press inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
          >
            Contact support
          </Link>
          <Link
            href="/orders"
            className="press inline-flex items-center gap-2 rounded-full bg-white/8 px-6 py-3 text-sm font-semibold text-cream-200 transition-colors hover:bg-white/12"
          >
            See your orders
          </Link>
        </div>
      </div>
    );
  }

  // A ready order means the server accepted a token or the session, so the
  // actions (cancel/review/support) can use the same credential the read used.
  return <TrackingView initialOrder={order} token={token ?? undefined} supportAccess />;
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
