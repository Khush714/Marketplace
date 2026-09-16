"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Clock3, ReceiptText, RefreshCcw, UtensilsCrossed } from "lucide-react";
import { BLUR_DATA, EmptyState } from "@/components/atoms";
import { cn, formatDateTime, formatINR } from "@/lib/domain";
import { useProfile } from "@/lib/profile";
import type { OrderDto } from "@/lib/types";

export default function OrdersPage() {
  const { orderCodes, hydrated } = useProfile();
  const [orders, setOrders] = useState<OrderDto[] | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!orderCodes.length) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetch(`/api/orders?codes=${orderCodes.join(",")}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled) setOrders(d.orders ?? []);
        })
        .catch(() => {
          if (!cancelled) setOrders([]);
        });
    };
    load();
    const t = window.setInterval(load, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [hydrated, orderCodes]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">History</p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Your orders</h1>

      {!hydrated || orders === null ? (
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
            const live = !o.status.delivered;
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
                        {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
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
                        <span className="text-xs text-cream-500">
                          {o.items.reduce((n, i) => n + i.quantity, 0)} items · {formatINR(o.totalCents)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-cream-500">
                          <Clock3 className="size-3" /> {formatDateTime(o.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2.5 border-t border-white/8 pt-4">
                    <Link
                      href={`/order/${o.code}/track`}
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

      <div className="mt-10 flex items-center justify-center gap-2 text-xs text-cream-600">
        <UtensilsCrossed className="size-3.5" /> Orders refresh automatically while they&apos;re live
      </div>
    </div>
  );
}
