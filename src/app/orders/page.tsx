"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MessageCircle,
  ReceiptText,
  RefreshCcw,
  Search,
  Star,
  UtensilsCrossed,
} from "lucide-react";
import { BLUR_DATA, EmptyState } from "@/components/atoms";
import { InvoiceLink } from "@/components/order-success";
import { useCart } from "@/lib/cart";
import { CANCEL_REASONS } from "@/lib/checkout-extras-core";
import { useCustomerAccount } from "@/lib/customer-account";
import { cn, formatDateTime, formatINR } from "@/lib/domain";
import {
  fetchPublicOrder,
  fetchSessionOrders,
  orderAuthHeaders,
  useOrderPoll,
} from "@/lib/order-access";
import {
  DEFAULT_HISTORY_LIMIT,
  HISTORY_STATUSES,
  MAX_HISTORY_LIMIT,
  filterHistory,
  paginateHistory,
  type HistoryQuery,
  type HistoryStatus,
} from "@/lib/order-history-core";
import { isOrderLive, type PublicOrder } from "@/lib/order-public";
import { useProfileOrders, useProfileReady } from "@/lib/profile";
import { buildReorderLines, menuItemsFromPayload } from "@/lib/reorder-core";
import { useToast } from "@/lib/toast";

const PAGE_SIZE = Math.min(DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
const MAX_CLIENT_ORDERS = 100;

const STATUS_LABELS: Record<HistoryStatus, string> = {
  all: "All orders",
  live: "Live",
  completed: "Completed",
  cancelled: "Cancelled",
};

const CANCEL_LABELS: Record<(typeof CANCEL_REASONS)[number], string> = {
  changed_mind: "Changed my mind",
  ordered_by_mistake: "Ordered by mistake",
  delivery_too_late: "Delivery too late",
  other: "Other",
};

function descending(a: PublicOrder, b: PublicOrder): number {
  return a.createdAt < b.createdAt ? 1 : -1;
}

function readOrderPage(raw: unknown): { orders: PublicOrder[]; nextOffset: number | null } {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { orders?: unknown; nextOffset?: unknown })
    : {};
  const orders = Array.isArray(rec.orders)
    ? rec.orders
        .filter((o): o is PublicOrder => !!o && typeof o === "object" && typeof (o as PublicOrder).code === "string")
        .slice(0, PAGE_SIZE)
    : [];
  const nextOffset =
    typeof rec.nextOffset === "number" && Number.isInteger(rec.nextOffset) && rec.nextOffset >= 0
      ? rec.nextOffset
      : null;
  return { orders, nextOffset };
}

export default function OrdersPage() {
  const { orders: stored } = useProfileOrders();
  const hydrated = useProfileReady();
  const account = useCustomerAccount();
  const router = useRouter();
  const { toast } = useToast();
  const cart = useCart();
  const [orders, setOrders] = useState<PublicOrder[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [status, setStatus] = useState<HistoryStatus>("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);

  const tokenByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of stored.slice(0, 30)) {
      if (row.code && row.token && !map.has(row.code)) map.set(row.code, row.token);
    }
    return map;
  }, [stored]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim().slice(0, 64)), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const pageQuery = useCallback(
    (offset: number): HistoryQuery => ({ limit: PAGE_SIZE, offset, status, q: query, from, to }),
    [from, query, status, to],
  );

  const loadPage = useCallback(
    async (offset: number): Promise<{ orders: PublicOrder[]; nextOffset: number | null }> => {
      const current = pageQuery(offset);
      const params = new URLSearchParams({ limit: String(current.limit), offset: String(current.offset) });
      if (current.status !== "all") params.set("status", current.status);
      if (current.q) params.set("q", current.q);
      if (current.from) params.set("from", current.from);
      if (current.to) params.set("to", current.to);

      if (account.status === "signedIn") {
        const res = await fetch(`/api/orders?${params.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        return readOrderPage(await res.json().catch(() => null));
      }

      const sessionPromise = fetchSessionOrders({
        limit: MAX_HISTORY_LIMIT,
        offset: 0,
        status: current.status,
        q: current.q,
        from: current.from,
        to: current.to,
      }).catch(() => ({ orders: [], nextOffset: null }));
      const tokenOrders = stored.length
        ? await fetch("/api/orders/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orders: stored.slice(0, 30).map((o) => ({ code: o.code, token: o.token })) }),
            cache: "no-store",
          })
            .then((res) => res.json().catch(() => null))
            .then((data: { orders?: PublicOrder[] } | null) => (Array.isArray(data?.orders) ? data.orders : []))
            .catch(() => [] as PublicOrder[])
        : [];
      const [session] = await Promise.all([sessionPromise]);
      const byCode = new Map<string, PublicOrder>();
      for (const order of tokenOrders) byCode.set(order.code, order);
      for (const order of session.orders) byCode.set(order.code, order);
      const all = [...byCode.values()].sort(descending);
      return paginateHistory(filterHistory(all, current), current);
    },
    [account.status, pageQuery, stored],
  );

  // Filter changes deliberately start a new first page; the interval below only
  // refreshes statuses of rows already on screen and never touches nextOffset.
  useEffect(() => {
    if (!hydrated || account.status === "loading") return;
    let cancelled = false;
    setOrders(null);
    setNextOffset(null);
    loadPage(0)
      .then((page) => {
        if (cancelled) return;
        setOrders(page.orders);
        setNextOffset(page.nextOffset);
      })
      .catch(() => {
        if (!cancelled) {
          setOrders([]);
          setNextOffset(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account.status, hydrated, loadPage]);

  const pollLoad = useCallback(async () => (await loadPage(0)).orders, [loadPage]);
  const pollApply = useCallback((rows: PublicOrder[]) => {
    setOrders((current) => {
      if (!current) return current;
      const byCode = new Map(rows.map((row) => [row.code, row]));
      return current.map((row) => byCode.get(row.code) ?? row);
    });
  }, []);
  useOrderPoll({
    load: pollLoad,
    onData: pollApply,
    intervalMs: 6000,
    live: account.status !== "loading" && (orders ?? []).some(isOrderLive),
  });

  async function loadMore() {
    if (nextOffset === null || loadingMore || !orders || orders.length >= MAX_CLIENT_ORDERS) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await loadPage(nextOffset);
      const currentCount = orders.length;
      setOrders((current) => {
        const byCode = new Map((current ?? []).map((row) => [row.code, row]));
        for (const row of page.orders) byCode.set(row.code, row);
        return [...byCode.values()].sort(descending).slice(0, MAX_CLIENT_ORDERS);
      });
      setNextOffset(
        currentCount + page.orders.length >= MAX_CLIENT_ORDERS || page.orders.length === 0
          ? null
          : page.nextOffset,
      );
    } catch {
      setMoreError("Could not load more orders. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function reorder(order: PublicOrder) {
    const href = `/restaurants/${encodeURIComponent(order.restaurantSlug)}`;
    try {
      const res = await fetch(`/api/restaurants/${encodeURIComponent(order.restaurantSlug)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        router.push(href);
        return;
      }
      const items = menuItemsFromPayload(await res.json().catch(() => null));
      if (items.length === 0) {
        router.push(href);
        return;
      }
      const result = buildReorderLines(order, items);
      const requested = result.lines.reduce((sum, line) => sum + line.quantity, 0);
      if (result.lines.length === 0) {
        toast("Nothing from that order is available now", { sub: "Opening the menu instead", kind: "error" });
        router.push(href);
        return;
      }
      let added = 0;
      for (const line of result.lines) {
        for (let unit = 0; unit < line.quantity && added < PAGE_SIZE * 4; unit += 1) {
          if (!cart.add(line, order.restaurantSlug, order.restaurantName)) break;
          added += 1;
        }
      }
      if (added === 0) {
        toast("Your cart holds another kitchen", {
          sub: "Choose Replace in the cart prompt, then try again",
          kind: "error",
        });
        router.push(href);
        return;
      }
      toast(
        added < requested ? "Some items could not be added" : result.changed ? "Added using today's menu" : "Order added to cart",
        {
          sub: result.unavailableNames.length
            ? `${result.unavailableNames.slice(0, 2).join(", ")}${result.unavailableNames.length > 2 ? " and more" : ""} unavailable`
            : undefined,
          kind: added < requested ? "error" : "info",
        },
      );
      router.push(href);
    } catch {
      router.push(href);
    }
  }

  async function cancelOrder(order: PublicOrder) {
    if (cancelBusy) return;
    const token = tokenByCode.get(order.code);
    if (!token && account.status !== "signedIn") return;
    setCancelBusy(order.code);
    try {
      const reason = cancelReason[order.code] ?? "";
      const res = await fetch(`/api/orders/${encodeURIComponent(order.code)}/cancel`, {
        method: "POST",
        headers: {
          ...orderAuthHeaders(token),
          ...(reason ? { "Content-Type": "application/json" } : {}),
        },
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as {
        cancelled?: boolean;
        pending?: boolean;
        reason?: string;
      } | null;
      if (!res.ok || (!data?.cancelled && !data?.pending)) {
        toast("Could not cancel that order", { sub: data?.reason ?? "Please try again", kind: "error" });
        return;
      }
      const updated = await fetchPublicOrder(order.code, token).catch(() => null);
      if (updated) {
        setOrders((current) => current?.map((row) => (row.code === updated.code ? updated : row)) ?? current);
      }
      toast(data.cancelled ? "Order cancelled" : "Cancellation requested");
    } catch {
      toast("Could not cancel that order", { sub: "Please try again", kind: "error" });
    } finally {
      setCancelBusy(null);
    }
  }

  const filterActive = status !== "all" || !!query || !!from || !!to;
  const showEmpty = orders !== null && orders.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-12 pt-6 md:px-6 md:pt-9">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">History</p>
      <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">Your orders</h1>

      <form
        onSubmit={(event) => event.preventDefault()}
        className="glass mt-6 grid gap-2.5 rounded-3xl p-4 sm:grid-cols-2 md:grid-cols-4"
        aria-label="Filter order history"
      >
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-cream-500">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as HistoryStatus)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-cream-100 focus:border-ember-400/60 focus:outline-none"
          >
            {HISTORY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-cream-500">Search</span>
          <span className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 px-3">
            <Search className="size-3.5 shrink-0 text-cream-600" />
            <input
              type="search"
              value={searchInput}
              maxLength={64}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Code, kitchen or dish"
              aria-label="Search orders"
              className="w-full bg-transparent py-2 text-sm text-cream-100 placeholder:text-cream-600 focus:outline-none"
            />
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-cream-500">From</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Orders from date"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-cream-100 focus:border-ember-400/60 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-cream-500">To</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            aria-label="Orders to date"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-cream-100 focus:border-ember-400/60 focus:outline-none"
          />
        </label>
        {filterActive && (
          <button
            type="button"
            onClick={() => {
              setStatus("all");
              setSearchInput("");
              setQuery("");
              setFrom("");
              setTo("");
            }}
            className="press w-fit text-xs font-semibold text-ember-400 transition-colors hover:text-ember-300 sm:col-span-2 md:col-span-4"
          >
            Clear filters
          </button>
        )}
      </form>

      {!hydrated || account.status === "loading" ? (
        <div className="mt-8 space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-40 rounded-3xl" />
          ))}
        </div>
      ) : account.status !== "signedIn" && showEmpty ? (
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
      ) : showEmpty ? (
        <div className="mt-10">
          <EmptyState
            icon={<ReceiptText className="size-6" />}
            title={filterActive ? "No orders match those filters" : "Your delicious history starts here"}
            sub={
              filterActive
                ? "Try a wider date range or clear the filters to see everything."
                : "Every order you place lands here, trackable down to the last turn."
            }
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
            const token = tokenByCode.get(o.code);
            const canCancel = live && o.status.cancellable && (!!token || account.status === "signedIn");
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
                        {o.scheduledFor && (
                          <span className="flex items-center gap-1 text-xs text-ember-300">
                            <CalendarDays className="size-3" /> Scheduled {formatDateTime(o.scheduledFor)}
                          </span>
                        )}
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

                  {canCancel && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/8 pt-3">
                      <label className="sr-only" htmlFor={`cancel-reason-${o.code}`}>
                        Cancellation reason for {o.code}
                      </label>
                      <select
                        id={`cancel-reason-${o.code}`}
                        value={cancelReason[o.code] ?? ""}
                        onChange={(event) =>
                          setCancelReason((current) => ({ ...current, [o.code]: event.target.value }))
                        }
                        className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-cream-200 focus:border-ember-400/60 focus:outline-none"
                      >
                        <option value="">Reason (optional)</option>
                        {CANCEL_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {CANCEL_LABELS[reason]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={cancelBusy === o.code}
                        onClick={() => void cancelOrder(o)}
                        className="press rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold text-chili-300 transition-colors hover:bg-white/12 disabled:opacity-60"
                      >
                        {cancelBusy === o.code ? "Sending…" : "Cancel order"}
                      </button>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2.5 border-t border-white/8 pt-4">
                    <Link
                      href={trackingHref}
                      className="press group flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/8 py-2.5 text-sm font-semibold text-cream-100 transition-colors hover:bg-white/12"
                    >
                      {live ? "Track live" : "View order"}
                      <ChevronRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </Link>
                    <Link
                      href={`/restaurants/${o.restaurantSlug}`}
                      onClick={(event) => {
                        event.preventDefault();
                        void reorder(o);
                      }}
                      className="press flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-ember-400 to-chili-600 py-2.5 text-sm font-bold text-white shadow-glow"
                    >
                      <RefreshCcw className="size-4" /> Reorder
                    </Link>
                    {token && (
                      <InvoiceLink
                        code={o.code}
                        token={token}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-white/12 px-3 py-2.5 text-xs font-semibold text-cream-300 transition-colors hover:bg-white/6"
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {nextOffset !== null && orders && orders.length < MAX_CLIENT_ORDERS && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-white/12 px-5 py-2.5 text-sm font-bold text-cream-200 transition-colors hover:bg-white/6 disabled:opacity-60"
          >
            {loadingMore && <LoaderCircle className="size-4 animate-spin-slow" />}
            {loadingMore ? "Loading…" : "Load more orders"}
          </button>
          {moreError && <p role="alert" className="text-xs text-chili-300">{moreError}</p>}
        </div>
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
