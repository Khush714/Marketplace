"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { currency } from "@/lib/format";
import { readRecentOrders, type RecentOrder } from "@/lib/recent-orders";

/**
 * Zomato-style "Your orders" rail on the marketplace home page.
 *
 * Reads orders persisted to localStorage (shared with the restaurant menu's
 * checkout flow) and hydrates a live status badge from the tracking API:
 *
 *   GET /api/marketplace/orders/:reference  →  { order: { lifecycle } }
 *
 * Nothing renders when the device has no order history. Live orders get an
 * orange status chip + pulsing dot; completed orders go green; cancelled red.
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
  "border-orange-200 bg-orange-50 text-orange-700";
const DONE_STATUS_STYLE = "border-emerald-200 bg-emerald-50 text-emerald-700";
const CANCEL_STATUS_STYLE = "border-red-200 bg-red-50 text-red-600";

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
    <section className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-base font-bold tracking-tight text-slate-900">
            Your orders
          </h2>
          {liveCount > 0 && (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-orange-600">
              {liveCount} active
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-50">
          {orders.map((o) => {
            const style = o.terminal
              ? o.status === "cancelled"
                ? CANCEL_STATUS_STYLE
                : DONE_STATUS_STYLE
              : LIVE_STATUS_STYLE;
            return (
              <Link
                key={o.saved.reference}
                href={`/orders/${encodeURIComponent(o.saved.reference)}`}
                className="flex items-center gap-4 px-5 py-4 transition hover:bg-orange-50/50"
              >
                {/* Status indicator */}
                <div
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${style}`}
                >
                  {o.terminal
                    ? o.status === "cancelled"
                      ? "✕"
                      : "✓"
                    : "🛵"}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {o.saved.restaurantName ||
                        o.saved.restaurantSlug ||
                        "Restaurant"}
                    </p>
                    {!o.terminal && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400">
                    {o.saved.reference} •{" "}
                    {new Date(o.saved.placedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-bold ${style}`}
                  >
                    {o.label}
                  </span>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {currency(o.saved.total)}
                  </p>
                </div>

                <span className="shrink-0 rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white">
                  Track
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}