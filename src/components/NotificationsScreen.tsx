"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { timeOfDay } from "@/lib/format";

type CustomerNotification = {
  id: number;
  kind: string;
  message: string;
  channel: string;
  status: string;
  at: string;
  orderId: number | null;
  reference: string | null;
};

const ORDER_CTA_KINDS = new Set([
  "order_placed",
  "order_accepted",
  "order_ready",
  "order_completed",
  "payment_successful",
]);

const KIND_STYLE: Record<string, { label: string; chip: string; dot: string }> =
  {
    order_placed: {
      label: "Order placed",
      chip: "bg-orange-100 text-orange-700",
      dot: "bg-orange-500",
    },
    order_accepted: {
      label: "Accepted",
      chip: "bg-sky-100 text-sky-700",
      dot: "bg-sky-500",
    },
    order_ready: {
      label: "Ready",
      chip: "bg-emerald-100 text-emerald-700",
      dot: "bg-emerald-500",
    },
    order_completed: {
      label: "Completed",
      chip: "bg-emerald-100 text-emerald-700",
      dot: "bg-emerald-500",
    },
    payment_successful: {
      label: "Payment",
      chip: "bg-violet-100 text-violet-700",
      dot: "bg-violet-500",
    },
  };

/**
 * PHASE 22 — customer notification feed. Each order-scoped notification
 * carries `reference` from the API and renders a "View Order" CTA straight to
 * the live tracking page (`/orders/:reference`).
 */
export function NotificationsScreen() {
  const [items, setItems] = useState<CustomerNotification[] | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/me/notifications")
      .then(async (r) => {
        if (r.status === 401) {
          if (active) setAuthRequired(true);
          return;
        }
        const data = await r.json().catch(() => null);
        if (!active) return;
        if (!r.ok) return;
        setItems(data?.notifications ?? []);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (authRequired) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-16 text-center sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-3 text-sm text-slate-500">
          Sign in with your phone to see order updates.
        </p>
        <Link
          href="/login?return=/notifications"
          className="mt-5 inline-block rounded-xl bg-orange-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-orange-600"
        >
          Sign in with phone
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>

      {items === null && (
        <div className="mt-6 space-y-3">
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
        </div>
      )}

      {items !== null && items.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">
          No notifications yet. Updates about your orders will appear here.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="mt-6 space-y-3">
          {items.map((n) => {
            const style = KIND_STYLE[n.kind] ?? {
              label: n.kind.replace(/_/g, " "),
              chip: "bg-slate-100 text-slate-600",
              dot: "bg-slate-400",
            };
            return (
              <li
                key={n.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.chip}`}
                  >
                    {style.label}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">
                    {timeOfDay(n.at)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{n.message}</p>
                {n.reference && ORDER_CTA_KINDS.has(n.kind) && (
                  <Link
                    href={`/orders/${encodeURIComponent(n.reference)}`}
                    className="mt-3 inline-flex rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-orange-600"
                  >
                    View Order
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}