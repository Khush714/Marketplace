"use client";

import { useCallback, useEffect, useState } from "react";
import { currency, shortDate } from "@/lib/format";

type AdminPayment = {
  id: number;
  order: {
    id: number;
    reference: string;
    customerName: string | null;
    paymentMethod: string | null;
    status: string | null;
  } | null;
  restaurant: { name: string | null; slug: string | null };
  amount: number;
  currency: string;
  status: string;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  refundId: string | null;
  refundAmount: number;
  failureReason: string | null;
  createdAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  created: "bg-white/5 text-white/60",
  authorized: "bg-blue-500/10 text-blue-400",
  captured: "bg-emerald-500/10 text-emerald-400",
  failed: "bg-rose-500/10 text-rose-400",
  refunded: "bg-white/10 text-white/60",
  partial_refunded: "bg-amber-500/10 text-amber-400",
};

export function PaymentsAdmin() {
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [stats, setStats] = useState({ total: 0, captured: 0, refunded: 0, failed: 0 });
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refundingId, setRefundingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/payments");
    if (!res.ok) return;
    const data = await res.json();
    setPayments(data.payments ?? []);
    setStats(data.stats ?? { total: 0, captured: 0, refunded: 0, failed: 0 });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refund(p: AdminPayment) {
    if (!window.confirm(`Refund ${currency(p.amount)} for order ${p.order?.reference}?`)) {
      return;
    }
    setRefundingId(p.id);
    setMessage(null);
    try {
      const res = await fetch("/api/payments/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: p.order?.reference }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Refund failed: ${data.error ?? "unknown error"}`);
      } else {
        setMessage(`Refund ${data.refundId} processed (${currency(data.amountInr)}).`);
        await load();
      }
    } catch {
      setMessage("Refund failed: network error");
    } finally {
      setRefundingId(null);
    }
  }

  const visible =
    filter === "all" ? payments : payments.filter((p) => p.status === filter);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={stats.total} />
        <Stat label="Captured" value={stats.captured} tone="emerald" />
        <Stat label="Refunded" value={stats.refunded} tone="amber" />
        <Stat label="Failed" value={stats.failed} tone="rose" />
      </div>

      {message && (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm ${
            message.startsWith("Refund failed")
              ? "border border-rose-500/25 bg-rose-500/10 text-rose-400"
              : "border border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          {message}
        </p>
      )}

      <div className="mt-5 flex gap-1 rounded-full border border-white/10 bg-white/5 p-0.5 text-xs">
        {["all", "captured", "refunded", "failed"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 truncate rounded-full px-3 py-1.5 font-semibold capitalize transition-colors ${
              filter === f ? "bg-ink-800 text-white" : "text-white/45 hover:text-white/65"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {loading && <div className="h-32 animate-pulse rounded-2xl bg-white/5" />}
        {!loading && visible.length === 0 && (
          <p className="rounded-2xl border border-dashed border-white/10 bg-ink-850 p-8 text-center text-sm text-white/45">
            No payments in this state.
          </p>
        )}
        {visible.map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-white">
                  {p.order?.reference ?? "Intent"} · {p.restaurant.name ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-white/45">
                  {p.order?.customerName ?? "No order yet"}
                  {" · "}
                  {shortDate(p.createdAt)}
                </p>
                <p className="mt-1 font-mono text-[11px] text-white/35">
                  {p.razorpayOrderId}
                  {p.razorpayPaymentId ? ` / ${p.razorpayPaymentId}` : ""}
                </p>
                {p.failureReason && (
                  <p className="mt-1 text-xs text-rose-400">{p.failureReason}</p>
                )}
                {p.refundId && (
                  <p className="mt-1 text-xs text-amber-400">
                    Refund {p.refundId} ({currency(p.refundAmount)})
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[p.status] ?? "bg-white/5 text-white/60"}`}>
                  {p.status.replace("_", " ")}
                </span>
                <span className="text-lg font-bold tabular-nums text-white">
                  {currency(p.amount)}
                </span>
              </div>
            </div>

            {p.status === "captured" && p.order && (
              <div className="mt-3 border-t border-white/6 pt-3">
                <button
                  onClick={() => refund(p)}
                  disabled={refundingId === p.id}
                  className="rounded-2xl bg-ember-500 px-4 py-2 text-xs font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
                >
                  {refundingId === p.id ? "Refunding…" : "Refund"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber" | "rose";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "amber"
        ? "text-amber-400"
        : tone === "rose"
          ? "text-rose-400"
          : "text-white";
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-850 p-4">
      <p className="text-xs font-medium text-white/40">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
