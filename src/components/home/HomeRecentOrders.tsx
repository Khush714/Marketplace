"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currency } from "@/lib/format";
import { readRecentOrders, type RecentOrder } from "@/lib/recent-orders";
import { ChevronRightIcon } from "../ui/icons";

/**
 * Zomato-style "Your orders" rail on the marketplace home page.
 *
 * Reads orders persisted to localStorage (shared with the restaurant menu's
 * checkout flow) and hydrates a live status badge from the tracking API:
 *
 *   GET /api/marketplace/orders/:reference  →  { order: { lifecycle } }
 *
 * Nothing renders when the device has no order history. Live orders get an
 * orange status chip + pulsing dot; terminal orders go green (delivered),
 * while cancelled / rejected orders go red.
 * Status is refreshed on mount and every time the tab becomes visible again,
 * so returning to home always shows current progress.
 */

type LiveOrder = {
  saved: RecentOrder;
  label: string;
  status: string;
  terminal: boolean;
};

const LIVE_STATUS_STYLE =
  "border-ember-500/25 bg-ember-500/10 text-ember-400";
const DONE_STATUS_STYLE = "border-emerald-400/20 bg-emerald-400/10 text-emerald-400";
const CANCEL_STATUS_STYLE = "border-red-500/20 bg-red-500/10 text-red-400";

export function HomeRecentOrders() {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      const saved = readRecentOrders().slice(0, 6);
      if (saved.length === 0) {
        if (alive) {
          setOrders([]);
          setLoaded(true);
        }
        return;
      }

      const results = await Promise.all(
        saved.map(async (s): Promise<LiveOrder> => {
          try {
            const res = await fetch(
              `/api/marketplace/orders/${encodeURIComponent(s.reference)}`,
            );
            const data = await res.json().catch(() => null);
            const order = data?.order;
            if (order?.lifecycle) {
              return {
                saved: s,
                label: order.lifecycle.label,
                status: order.lifecycle.status,
                terminal: order.lifecycle.terminal,
              };
            }
          } catch {
            // fall through to the stored fallback below
          }
          // Fetch failed or unreachable — never drop a real order from the
          // list; default to "placed" so it still links to tracking.
          return { saved: s, label: "Order placed", status: "placed", terminal: false };
        }),
      );

      if (alive) {
        setOrders(results);
        setLoaded(true);
      }
    }

    void refresh();

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!loaded || orders.length === 0) return null;

  const liveCount = orders.filter((o) => !o.terminal).length;

  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <div className="card-lift overflow-hidden rounded-3xl border border-white/8 bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <div className="flex items-center justify-between border-b border-white/6 px-5 py-3.5">
          <h2 className="text-base font-semibold tracking-tight text-white">
            Your orders
          </h2>
          {liveCount > 0 && (
            <span className="rounded-full border border-ember-500/25 bg-ember-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-ember-400">
              {liveCount} active
            </span>
          )}
        </div>

        <div className="divide-y divide-white/5">
          {orders.map((o) => {
            const failed = o.status === "cancelled" || o.status === "rejected";
            const style = o.terminal
              ? failed
                ? CANCEL_STATUS_STYLE
                : DONE_STATUS_STYLE
              : LIVE_STATUS_STYLE;
            return (
              <Link
                key={o.saved.reference}
                href={`/orders/${encodeURIComponent(o.saved.reference)}`}
                className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-5 sm:py-4 transition-colors hover:bg-white/5"
              >
                {/* Status indicator */}
                <div
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${style}`}
                >
                  {o.terminal
                    ? failed
                      ? "✕"
                      : "✓"
                    : "🛵"}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-white">
                      {o.saved.restaurantName ||
                        o.saved.restaurantSlug ||
                        "Restaurant"}
                    </p>
                    {!o.terminal && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-ember-500" />
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-white/40">
                    {o.saved.reference}
                    <span className="hidden sm:inline">
                      {" "}•{" "}
                      {new Date(o.saved.placedAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold sm:px-3 sm:py-1 sm:text-[11px] ${style}`}
                  >
                    {o.label}
                  </span>
                  <p className="mt-1 text-sm font-semibold text-white/80">
                    {currency(o.saved.total)}
                  </p>
                </div>

                <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-ember-500 px-3 py-2 text-xs font-bold text-ink-950 sm:px-4">
                  Track <ChevronRightIcon className="text-sm" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}