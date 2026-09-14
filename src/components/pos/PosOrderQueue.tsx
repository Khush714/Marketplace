"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { currency, shortDate, shortDateTime } from "@/lib/format";
import { isTerminal, legacyToCanonical, statusLabel, type OrderLifecycleStatus } from "@/lib/order-lifecycle";

type PosOrderItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: { modifierName: string; priceDelta: number }[];
};
type PosOrder = {
  id: number;
  reference: string;
  status: string;
  rawStatus: string;
  fulfillment: string;
  totals: { subtotal: number; tax: number; discount: number; deliveryFee: number; total: number };
  customer: { name: string; address: string };
  notes: string;
  placedAt: string;
  scheduledFor: string | null;
  items: PosOrderItem[];
};

type PosOrderQueueProps = {
  restaurantName: string;
  slug: string;
  initialKey: string;
};

// PHASE 9 — the POS's "next action" IS the lifecycle's accepted edge from the
// current canonical status. Legacy aliases (e.g. a stored `completed`) map
// through legacyToCanonical before lookup, so this stays correct even for rows
// written by older code.
const NEXT_ACTION: Record<string, { to: string; label: string; icon: string }> = {
  placed: { to: "accepted", label: "ACCEPT", icon: "✅" },
  accepted: { to: "preparing", label: "START PREPARING", icon: "👨‍🍳" },
  preparing: { to: "ready", label: "MARK READY", icon: "🛎️" },
  ready: { to: "picked_up", label: "MARK PICKED UP", icon: "🛵" },
  picked_up: { to: "delivered", label: "CONFIRM DELIVERED", icon: "🎉" },
};

const nextActionFor = (status: string) =>
  NEXT_ACTION[legacyToCanonical(status)] ?? null;

export function PosOrderQueue({ restaurantName, slug, initialKey }: PosOrderQueueProps) {
  const [key, setKey] = useState(initialKey);
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [filter, setFilter] = useState("active"); // active | all
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const first = useRef(true);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const res = await fetch(`/api/pos/orders?key=${encodeURIComponent(key)}`);
      if (res.status === 401) {
        setConnected(false);
        setError("Invalid POS key for this restaurant.");
        return;
      }
      const data = await res.json();
      setConnected(true);
      setError(null);
      setOrders(data.orders ?? []);
    } catch {
      setConnected(false);
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    load();
    if (first.current) {
      first.current = false;
      return;
    }
  }, [key, load]);

  // Auto-poll: more frequently when there are live orders.
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [connected, load]);

  async function transition(order: PosOrder, to: string) {
    setBusyRef(order.reference);
    setError(null);
    try {
      const res = await fetch(
        `/api/pos/orders/${order.reference}/transition?key=${encodeURIComponent(key)}&to=${to}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not update order");
      } else {
        await load();
      }
    } catch {
      setError("Network error updating order");
    } finally {
      setBusyRef(null);
    }
  }

  const visible = orders.filter((o) =>
    filter === "active" ? !isTerminal(o.status) : true,
  );
  const activeCount = orders.filter((o) => !isTerminal(o.status)).length;

  if (!key) {
    return (
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-6">
        <p className="font-semibold text-amber-400">Connect this POS</p>
        <p className="mt-1 text-sm text-white/60">
          Generate a POS key for {restaurantName} to unlock its order queue.
        </p>
        <button
          onClick={async () => {
            const res = await fetch(`/api/admin/pos/${slug}/key`, { method: "POST" });
            const data = await res.json();
            if (res.ok) {
              setKey(data.posKey);
              // Clear the query param so the key isn't in the address bar
              window.history.replaceState(null, "", `/admin/pos/${slug}`);
              setConnected(true);
            } else {
              setError(data.error ?? "Could not generate key");
            }
          }}
          className="mt-4 rounded-2xl bg-ember-500 px-5 py-2.5 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
        >
          Generate POS key
        </button>
        <p className="mt-3 text-xs text-amber-400">
          This key is shown once. Wire it into your existing POS system where it
          polls <code>/api/pos/orders</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`grid h-2.5 w-2.5 rounded-full ${
              connected ? "bg-emerald-500" : "bg-rose-500"
            }`}
          />
          <span className="text-sm text-white/60">
            {connected ? "Connected" : "Offline"} · {activeCount} live order
            {activeCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
          <button
            onClick={() => setFilter("active")}
            className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${
              filter === "active" ? "bg-ink-800 text-white" : "text-white/45 hover:text-white/65"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full px-3 py-1.5 font-semibold transition-colors ${
              filter === "all" ? "bg-ink-800 text-white" : "text-white/45 hover:text-white/65"
            }`}
          >
            All
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error}
        </p>
      )}

      {visible.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-ink-850 p-10 text-center text-sm text-white/45">
          {filter === "active"
            ? "No live orders. New marketplace orders appear here automatically."
            : "No orders yet."}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {visible.map((o) => {
          const action = nextActionFor(o.status);
          return (
            <article
              key={o.id}
              className={`overflow-hidden rounded-2xl border bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${
                legacyToCanonical(o.status) === "placed" ? "border-ember-500/40" : "border-white/8"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 bg-white/5 px-4 py-3">
                {legacyToCanonical(o.status) === "placed" && (
                  <span className="rounded-full bg-ember-500 px-2.5 py-1 text-xs font-bold tracking-wide text-ink-950">
                    NEW ONLINE ORDER
                  </span>
                )}
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-white">#{o.reference}</span>
                  <span className="text-xs text-white/45">{shortDate(o.placedAt)}</span>
                  {o.scheduledFor && (
                    <span
                      title={new Date(o.scheduledFor).toLocaleString()}
                      className="rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-400"
                    >
                      Sched {shortDateTime(new Date(o.scheduledFor))}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold text-white/80">
                    {o.fulfillment === "pickup" ? "PICKUP" : "ONLINE"}
                  </span>
                  <span className="text-xs font-medium text-white/45">
                    {statusLabel(o.status)}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3">
                <ul className="space-y-1.5 text-sm">
                  {o.items.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-2">
                      <span className="text-white/70">
                        {i.name} × {i.quantity}
                        {i.modifiers.length > 0 && (
                          <span className="block pl-2 text-xs text-white/35">
                            {i.modifiers.map((m) => m.modifierName).join(" • ")}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums text-white/60">
                        {currency(i.unitPrice * i.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                {o.notes && (
                  <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
                    📝 {o.notes}
                  </p>
                )}

                <div className="mt-3 space-y-0.5 border-t border-white/6 pt-3 text-sm">
                  <div className="flex justify-between text-white/60">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{currency(o.totals.subtotal)}</span>
                  </div>
                  {o.totals.discount > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Discount</span>
                      <span className="tabular-nums">−{currency(o.totals.discount)}</span>
                    </div>
                  )}
                  {o.totals.tax > 0 && (
                    <div className="flex justify-between text-white/60">
                      <span>Tax</span>
                      <span className="tabular-nums">{currency(o.totals.tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold text-white">
                    <span>Total</span>
                    <span className="tabular-nums">{currency(o.totals.total)}</span>
                  </div>
                </div>

                {o.customer.address && (
                  <p className="mt-2 text-xs text-white/45">
                    {o.fulfillment === "pickup" ? "For pickup" : `Deliver to`}:{" "}
                    {o.customer.name}
                    {o.fulfillment !== "pickup" && ` — ${o.customer.address}`}
                  </p>
                )}
              </div>

              {action && (
                <div className="border-t border-white/6 px-4 py-3">
                  <button
                    onClick={() => transition(o, action.to)}
                    disabled={busyRef === o.reference}
                    className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold tracking-wide text-ink-950 transition-all duration-200 hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-60"
                  >
                    {busyRef === o.reference ? "UPDATING…" : `${action.icon} ${action.label}`}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
