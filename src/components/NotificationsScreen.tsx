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
  "order_delivered",
  "order_rejected",
  "payment_successful",
]);

const KIND_STYLE: Record<string, { label: string; chip: string; dot: string }> =
  {
    order_placed: {
      label: "Order placed",
      chip: "bg-ember-500/15 text-ember-400",
      dot: "bg-ember-500",
    },
    order_accepted: {
      label: "Accepted",
      chip: "bg-sky-500/15 text-sky-400",
      dot: "bg-sky-500",
    },
    order_ready: {
      label: "Ready",
      chip: "bg-emerald-500/15 text-emerald-400",
      dot: "bg-emerald-500",
    },
    order_completed: {
      label: "Completed",
      chip: "bg-emerald-500/15 text-emerald-400",
      dot: "bg-emerald-500",
    },
    order_delivered: {
      label: "Delivered",
      chip: "bg-emerald-500/15 text-emerald-400",
      dot: "bg-emerald-500",
    },
    order_rejected: {
      label: "Rejected",
      chip: "bg-rose-500/15 text-rose-400",
      dot: "bg-rose-500",
    },
    payment_successful: {
      label: "Payment",
      chip: "bg-violet-500/15 text-violet-400",
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
        <h1 className="text-2xl font-bold tracking-tight text-white">Notifications</h1>
        <p className="mt-3 text-sm text-white/45">
          Sign in with your phone to see order updates.
        </p>
        <Link
          href="/login?return=/notifications"
          className="mt-5 inline-block rounded-2xl bg-ember-500 px-6 py-2.5 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
        >
          Sign in with phone
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-white">Notifications</h1>

      {items === null && (
        <div className="mt-6 space-y-3">
          <div className="h-24 animate-pulse rounded-3xl bg-white/5" />
          <div className="h-24 animate-pulse rounded-3xl bg-white/5" />
        </div>
      )}

      {items !== null && items.length === 0 && (
        <p className="mt-6 text-sm text-white/40">
          No notifications yet. Updates about your orders will appear here.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="mt-6 space-y-3">
          {items.map((n) => {
            const style = KIND_STYLE[n.kind] ?? {
              label: n.kind.replace(/_/g, " "),
              chip: "bg-white/5 text-white/55",
              dot: "bg-white/35",
            };
            return (
              <li
                key={n.id}
                className="rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.chip}`}
                  >
                    {style.label}
                  </span>
                  <span className="ml-auto text-xs text-white/35">
                    {timeOfDay(n.at)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-white/70">{n.message}</p>
                {n.reference && ORDER_CTA_KINDS.has(n.kind) && (
                  <Link
                    href={`/orders/${encodeURIComponent(n.reference)}`}
                    className="mt-3 inline-flex rounded-2xl bg-ember-500 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
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
