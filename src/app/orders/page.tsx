"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronRight, Clock3, LoaderCircle, MessageCircle, ReceiptText, RefreshCcw, Star, UtensilsCrossed } from "lucide-react";
import { BLUR_DATA, EmptyState } from "@/components/atoms";
import { useCustomerAccount } from "@/lib/customer-account";
import { cn, formatDateTime, formatINR } from "@/lib/domain";
import { fetchSessionOrders, useOrderPoll } from "@/lib/order-access";
import { isOrderLive, type PublicOrder } from "@/lib/order-public";
import { useProfileOrders, useProfileReady } from "@/lib/profile";

export default function OrdersPage() {
  const { orders: stored } = useProfileOrders();
  const hydrated = useProfileReady();
  const account = useCustomerAccount();
  const [orders, setOrders] = useState<PublicOrder[] | null>(null);

  /**
   * Signed in: account-linked orders only, so a shared browser cannot mix a
   * previous visitor's device/session orders into this customer's history.
   * Signed out: the session read is the durable one — it survives a cleared
   * localStorage because the credential is an HttpOnly cookie bound to the
   * order codes at checkout. The token lookup is kept for older orders that
   * predate session binding (and for a lapsed session); a code alone still
   * grants nothing there. Merging by code avoids duplicates while both paths
   * overlap.
   */
  const loadOrders = useCallback(async (): Promise<PublicOrder[]> => {
    const byCode = new Map<string, PublicOrder>();

    if (account.status === "signedIn") {
      const res = await fetch("/api/orders", { cache: "no-store", credentials: "same-origin" })
        .then(async (r) => ((await r.json().catch(() => null)) as { orders?: PublicOrder[] } | null))
        .catch(() => null);
      for (const order of res?.orders ?? []) byCode.set(order.code, order);
    } else if (account.status === "signedOut") {
      const tokenOrders = stored.length
        ? await fetch("/api/orders/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orders: stored.slice(0, 30).map((o) => ({ code: o.code, token: o.token })) }),
            cache: "no-store",
          })
            .then((res) => res.json().catch(() => null))
            .then((data: { orders?: PublicOrder[] } | null) => data?.orders ?? [])
            .catch(() => [])
        : [];
      const sessionOrders = await fetchSessionOrders().catch(() => []);
      for (const order of tokenOrders) byCode.set(order.code, order);
      for (const order of sessionOrders) byCode.set(order.code, order);
    }

    return [...byCode.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [account.status, stored]);

  // First paint only. The interval below owns every fetch after this one.
  useEffect(() => {
    if (!hydrated) return;
    if (account.status === "loading") return;
    let cancelled = false;
    loadOrders()
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, account.status, loadOrders]);

  /**
   * Refreshes only while something on this page can still change. A history
   * page of settled orders has nothing to re-read, so the loop tears itself down
   * instead of asking the server about a dozen closed orders every 6 seconds.
   */
  useOrderPoll({
    load: loadOrders,
    onData: setOrders,
    intervalMs: 6000,
    live: account.status !== "loading" && (orders ?? []).some(isOrderLive),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">History</p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Your orders</h1>

      {!hydrated || account.status === "loading" ? (
        <div className="mt-8 space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-40 rounded-3xl" />
          ))}
        </div>
      ) : account.status !== "signedIn" && orders?.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<ReceiptText className="size-6" />}
            title="Sign in to view your orders"
            sub="Your order history is linked to your account so it stays private and available across devices."
            action={
              <Link
                href="/profile"
                className="press mt-2 flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
              >
                Sign in <ArrowRight className="size-4" />
              </Link>
            }
          />
        </div>
      ) : orders === null ? (
        <div className="mt-8 space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-40 rounded-3xl" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<ReceiptText className="size-6" />}
            title="Your delicious history starts here"
            sub="Every order you place lands here, trackable down to the last turn."
            action={
              <Link
                href="/restaurants"
                className="press mt-2 flex items-center gap-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-6 py-3 text-sm font-bold text-white shadow-glow"
              >
                Order something <ArrowRight className="size-4" />
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="mt-7 space-y-4">
          {orders.map((o, idx) => {
            const live = isOrderLive(o);
            const trackingHref = `/order/${o.code}/track`;
            return (
              <li key={o.code} style={{ animationDelay: `${idx * 60}ms` }} className="animate-rise">
                <div className="glass lift rounded-3xl p-4 hover:shadow-lift md:p-5">
                  <div className="flex items-start gap-4">
                    <span className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-white/6">
                      {o.items[0]?.imageUrl && (
                        <Image
                          src={o.items[0].imageUrl}
                          alt=""
                          fill
                          sizes="64px"
                          placeholder="blur"
                          blurDataURL={BLUR_DATA}
                          className="object-cover"
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="truncate font-display text-lg font-bold text-cream-50">{o.restaurantName}</h2>
                        <span className="shrink-0 font-mono text-[11px] font-semibold uppercase text-cream-500">{o.code}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-cream-500">
                        {o.items
                          .map((i) => `${i.quantity}× ${i.name}`)
                          .join(", ")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span
                          className={cn(
                            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
                            live ? "bg-ember-400/12 text-ember-300" : "bg-mint-500/12 text-mint-400",
                          )}
                        >
                          <span className="relative flex size-1.5">
                            {live && <span className="animate-dot-ping absolute inline-flex h-full w-full rounded-full bg-ember-400" />}
                            <span className={cn("relative inline-flex size-1.5 rounded-full", live ? "bg-ember-400" : "bg-mint-400")} />
                          </span>
                          {o.status.stageLabel}
                        </span>
                        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-cream-400">
                          {o.fulfilment === "pickup" ? "Pickup" : "Delivery"}
                        </span>
                        <span className="text-xs text-cream-500">
                          {o.items.reduce((n, i) => n + i.quantity, 0)} items · {formatINR(o.totalCents)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-cream-500">
                          <Clock3 className="size-3" /> {formatDateTime(o.createdAt)}
                        </span>
                        {o.status.statusUpdatedAt && (
                          <span className="text-xs text-cream-500">
                            {live ? "Updated" : "Last update"} {formatDateTime(o.status.statusUpdatedAt)}
                          </span>
                        )}
                        {!live && o.feedback.feedbackAt && o.feedback.rating && (
                          <span className="flex items-center gap-1 text-xs font-semibold text-ember-300">
                            <Star className="size-3 fill-current" />
                            Rated {o.feedback.rating}/5
                          </span>
                        )}
                        {o.unreadOpsReply && (
                          <span className="flex items-center gap-1 rounded-full bg-ember-400/15 px-2 py-0.5 text-[11px] font-bold text-ember-300">
                            <MessageCircle className="size-3" /> New support reply
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2.5 border-t border-white/8 pt-4">
                    <Link
                      href={trackingHref}
                      className="press group flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/8 py-2.5 text-sm font-semibold text-cream-100 transition-colors hover:bg-white/12"
                    >
                      {live ? "Track live" : "View order"}
                      <ChevronRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </Link>
                    <Link
                      href={`/restaurants/${o.restaurantSlug}`}
                      className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-2.5 text-sm font-bold text-white shadow-glow"
                    >
                      <RefreshCcw className="size-4" /> Reorder
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10 flex flex-col items-center justify-center gap-2 text-center text-xs text-cream-600">
        <span className="flex items-center gap-2">
          <UtensilsCrossed className="size-3.5" /> Orders refresh automatically while they&apos;re live
        </span>
        <Link href="/contact" className="font-semibold text-ember-400 transition-colors hover:text-ember-300">
          Need help with an order? Contact support
        </Link>
      </div>
    </div>
  );
}
