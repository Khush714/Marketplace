"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ClipboardList, Printer, RefreshCw } from "lucide-react";
import { cn, formatINR } from "@/lib/domain";
import { partnerFetch, RequirePartnerSession } from "@/lib/partner-session";
import { useToast } from "@/lib/toast";

type KdsStatus =
  | "PLACED"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

interface KdsItem {
  name: string;
  quantity: number;
  priceCents?: number;
  isVeg?: boolean;
  modifiers?: Array<{ groupName?: string; optionName?: string; name?: string }>;
}

interface KdsOrder {
  code: string;
  restaurantName: string;
  items: KdsItem[];
  addressLabel: string;
  addressText: string;
  customerName: string;
  phone: string;
  paymentMethod: string;
  instructions: string;
  totalCents: number;
  fulfilment: "pickup" | "delivery";
  status: KdsStatus;
  statusUpdatedAt: string;
  prepMinutes: number | null;
  createdAt: string;
  scheduledFor: string | null;
  integrationStatus?: string | null;
}

const COLUMNS = [
  { key: "new", label: "New", statuses: ["PLACED", "ACCEPTED"] },
  { key: "preparing", label: "Preparing", statuses: ["PREPARING"] },
  { key: "ready", label: "Ready", statuses: ["READY"] },
] as const;

const PRINT_STYLES = `
  @page { margin: 8mm; }
  @media print {
    body { background: #fff !important; }
    .partner-print-hide { display: none !important; }
    .thermal-ticket {
      width: 80mm !important;
      max-width: 80mm !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #000 !important;
      padding: 0 !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .thermal-ticket * { color: #000 !important; }
  }
`;

function validCode(raw: string | undefined): string {
  return raw && /^[A-Za-z0-9_-]{4,64}$/.test(raw) ? raw : "";
}

function elapsedLabel(order: KdsOrder, now: number): string {
  const changed = Date.parse(order.statusUpdatedAt || order.createdAt);
  if (!Number.isFinite(changed)) return "—";
  const minutes = Math.max(0, Math.floor((now - changed) / 60_000));
  const elapsed = minutes < 1 ? "just now" : `${minutes}m`;
  if (order.prepMinutes === null || order.prepMinutes <= 0) return elapsed;
  if (minutes >= order.prepMinutes) return `${elapsed} · ${minutes - order.prepMinutes}m over`;
  return `${elapsed} · ${order.prepMinutes - minutes}m left`;
}

function itemLine(item: KdsItem): string {
  const extras = (item.modifiers ?? [])
    .map((modifier) => modifier.optionName ?? modifier.name ?? modifier.groupName ?? "")
    .filter(Boolean)
    .join(", ");
  return `${item.quantity} × ${item.name}${extras ? ` (${extras})` : ""}`;
}

export default function KdsBoard({
  mode,
  initialCode = "",
}: {
  mode: "kds" | "print";
  initialCode?: string;
}) {
  const { toast } = useToast();
  const code = validCode(initialCode);
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (quiet = false) => {
      setLoading(true);
      const path = code
        ? `/api/partner/orders?status=all&limit=50&search=${encodeURIComponent(code)}`
        : "/api/partner/orders?status=active&limit=50";
      const result = await partnerFetch<{ orders: KdsOrder[] }>(path);
      setLoading(false);
      if (!result.ok) {
        setOrders([]);
        if (!quiet) toast(result.error, { kind: "error" });
        return;
      }
      setOrders(result.orders ?? []);
      setLoaded(true);
    },
    [code, toast],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const refresh = window.setInterval(() => void load(true), 30_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [load]);

  const isPrint = mode === "print";
  const shown = code ? orders.filter((order) => order.code === code) : orders;

  return (
    <div className={cn("mx-auto max-w-6xl px-4 pb-12 pt-6 md:px-6 md:pt-9", isPrint && "max-w-3xl")}>
      {isPrint && <style>{PRINT_STYLES}</style>}
      <div className={cn("flex flex-wrap items-center gap-2", isPrint && "partner-print-hide")}>
        <Link
          href="/partner/menu"
          className="press inline-flex items-center gap-1.5 text-xs font-semibold text-cream-400 transition-colors hover:text-cream-200"
        >
          <ArrowLeft className="size-3.5" /> Menu editor
        </Link>
        <Link
          href={isPrint ? "/partner/kds" : "/partner/print"}
          className="press inline-flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-1.5 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12"
        >
          {isPrint ? <ClipboardList className="size-3.5" /> : <Printer className="size-3.5" />}
          {isPrint ? "Kitchen display" : "Print tickets"}
        </Link>
      </div>

      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
        {isPrint ? "Print tickets" : "Kitchen display"}
      </h1>
      <p className={cn("mt-2 max-w-2xl text-sm leading-relaxed text-cream-400", isPrint && "partner-print-hide")}>
        Read-only. The POS is authoritative for order status; changes made there appear on the next
        refresh. Nothing on this screen writes an order.
      </p>

      <RequirePartnerSession>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={cn(
              "press flex items-center gap-1.5 rounded-xl bg-white/8 px-3.5 py-2 text-xs font-semibold text-cream-200 transition-colors hover:bg-white/12 disabled:opacity-50",
              isPrint && "partner-print-hide",
            )}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </button>
          {isPrint && (
            <button
              type="button"
              onClick={() => window.print()}
              className="partner-print-hide press flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 px-4 py-2 text-xs font-bold text-white transition-opacity"
            >
              <Printer className="size-3.5" /> Print
            </button>
          )}
          {code && <span className="font-mono text-xs text-cream-500">Order {code}</span>}
          <span className="ml-auto text-[11px] text-cream-600">
            {shown.length} order{shown.length === 1 ? "" : "s"}
          </span>
        </div>

        {!loaded && !loading ? (
          <p className="mt-5 rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center text-xs text-cream-500">
            Loading orders…
          </p>
        ) : shown.length === 0 ? (
          <p className="mt-5 rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-8 text-center text-xs text-cream-500">
            {code ? "That order is not in your active inbox." : "No active orders right now."}
          </p>
        ) : isPrint ? (
          <div className="mt-5 space-y-5">
            {shown.map((order) => (
              <article key={order.code} className="thermal-ticket rounded-2xl border border-white/10 bg-white/[0.045] p-4 font-mono text-xs text-cream-200">
                <h2 className="text-center text-base font-bold tracking-tight">{order.restaurantName}</h2>
                <p className="mt-1 text-center text-[11px]">Order {order.code}</p>
                <p className="mt-1 text-center text-[11px]">
                  {order.fulfilment === "pickup" ? "PICKUP" : "DELIVERY"} · {order.status}
                </p>
                <p className="my-3 border-y border-dashed border-white/20 py-2 text-center text-[11px]">
                  {new Date(order.createdAt).toLocaleString("en-IN")}
                </p>
                <ul className="space-y-1">
                  {order.items.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="flex justify-between gap-3">
                      <span>{itemLine(item)}</span>
                      {item.priceCents !== undefined && <span>{formatINR(item.priceCents)}</span>}
                    </li>
                  ))}
                </ul>
                <p className="my-3 border-y border-dashed border-white/20 py-2 text-right font-bold">
                  Total {formatINR(order.totalCents)}
                </p>
                <p className="text-[11px]">Customer: {order.customerName || order.phone}</p>
                {order.fulfilment === "delivery" && (
                  <p className="mt-0.5 text-[11px]">
                    {order.addressLabel} · {order.addressText}
                  </p>
                )}
                {order.instructions && <p className="mt-2 text-[11px]">Note: {order.instructions}</p>}
                <p className="mt-3 text-center text-[10px]">POS-managed · read-only</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {COLUMNS.map((column) => {
              const columnOrders = shown.filter((order) => (column.statuses as readonly string[]).includes(order.status));
              return (
                <section key={column.key} className="glass rounded-3xl p-4">
                  <h2 className="flex items-center justify-between font-display text-base font-bold text-cream-50">
                    {column.label}
                    <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-cream-400">
                      {columnOrders.length}
                    </span>
                  </h2>
                  <div className="mt-3 space-y-2.5">
                    {columnOrders.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-[11px] text-cream-600">
                        Empty
                      </p>
                    ) : (
                      columnOrders.map((order) => (
                        <article key={order.code} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-cream-50">{order.code}</span>
                            {order.integrationStatus && (
                              <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[10px] font-bold text-sky-300">
                                POS-managed
                              </span>
                            )}
                            <span className="ml-auto font-mono text-[11px] text-ember-300">
                              {elapsedLabel(order, now)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-cream-500">
                            {order.customerName || order.phone || "Guest"} · {order.fulfilment}
                            {order.scheduledFor ? ` · ${new Date(order.scheduledFor).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                          </p>
                          <ul className="mt-2 space-y-0.5 text-xs text-cream-200">
                            {order.items.map((item, index) => (
                              <li key={`${item.name}-${index}`}>{itemLine(item)}</li>
                            ))}
                          </ul>
                          {order.instructions && (
                            <p className="mt-2 rounded-lg bg-white/[0.045] px-2 py-1.5 text-[11px] text-cream-400">
                              {order.instructions}
                            </p>
                          )}
                        </article>
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </RequirePartnerSession>
    </div>
  );
}
