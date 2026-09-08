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
  created: "bg-slate-100 text-slate-600",
  authorized: "bg-blue-50 text-blue-700",
  captured: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  refunded: "bg-slate-200 text-slate-600",
  partial_refunded: "bg-amber-50 text-amber-700",
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
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Total" value={stats.total} />
        <Stat label="Captured" value={stats.captured} tone="emerald" />
        <Stat label="Refunded" value={stats.refunded} tone="amber" />
        <Stat label="Failed" value={stats.failed} tone="rose" />
      </div>

      {message && (
        <p
          className={`mt-4 rounded-xl px-4 py-3 text-sm ${
            message.startsWith("Refund failed")
              ? "bg-rose-50 text-rose-600"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {message}
        </p>
      )}

      <div className="mt-5 flex gap-1 rounded-full border border-slate-200 bg-white p-0.5 text-xs">
        {["all", "captured", "refunded", "failed"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 truncate rounded-full px-3 py-1.5 font-semibold capitalize ${
              filter === f ? "bg-slate-900 text-white" : "text-slate-500"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {loading && <div className="h-32 animate-pulse rounded-2xl bg-slate-200" />}
        {!loading && visible.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No payments in this state.
          </p>
        )}
        {visible.map((p) => (
          <article
            key={p.id}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">
                  {p.order?.reference ?? "Intent"} · {p.restaurant.name ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {p.order?.customerName ?? "No order yet"}
                  {" · "}
                  {shortDate(p.createdAt)}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {p.razorpayOrderId}
                  {p.razorpayPaymentId ? ` / ${p.razorpayPaymentId}` : ""}
                </p>
                {p.failureReason && (
                  <p className="mt-1 text-xs text-rose-500">{p.failureReason}</p>
                )}
                {p.refundId && (
                  <p className="mt-1 text-xs text-amber-600">
                    Refund {p.refundId} ({currency(p.refundAmount)})
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[p.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {p.status.replace("_", " ")}
                </span>
                <span className="text-lg font-bold tabular-nums text-slate-900">
                  {currency(p.amount)}
                </span>
              </div>
            </div>

            {p.status === "captured" && p.order && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <button
                  onClick={() => refund(p)}
                  disabled={refundingId === p.id}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
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
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "rose"
          ? "text-rose-600"
          : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}