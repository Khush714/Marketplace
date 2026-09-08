"use client";

import Link from "next/link";
import { statusLabel } from "@/lib/order-lifecycle";
import { shortDate, timeAgo } from "@/lib/format";
import { useOrderTracking } from "@/hooks/useOrderTracking";
import type { OrderTracking } from "@/hooks/useOrderTracking";
import type { PublicOrder } from "@/lib/marketplace";
import { OrderCancelButton } from "./OrderCancelButton";
import { OrderDetails } from "./OrderDetails";
import { OrderTimeline } from "./OrderTimeline";
import { OrderTypeInfo } from "./OrderTypeInfo";
import { PaymentStatus } from "./PaymentStatus";
import { OrderSkeleton } from "./OrderSkeleton";

const STEPS = ["placed", "accepted", "preparing", "ready", "completed"] as const;

export function OrderTracker({ reference }: { reference: string }) {
  const {
    order,
    brand,
    loading,
    refreshing,
    loadError,
    refreshError,
    lastUpdatedAt,
    notFound,
    orderingDisabled,
    cancelOrder,
    cancelling,
    cancelError,
    retry,
    refresh,
  } = useOrderTracking(reference);

  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mt-6 sm:mt-8">
        <Link
          href="/"
          className="text-sm text-slate-500 hover:text-orange-600 hover:underline"
        >
          ← Home
        </Link>
      </nav>

      {/* Desktop chrome — mobile keeps the reference inside the card. */}
      <h1 className="mt-4 hidden text-center text-2xl font-bold tracking-tight text-slate-900 sm:block">
        Order Tracker
      </h1>

      {loading && !order && !loadError && <OrderSkeleton />}

      {orderingDisabled && !order && (
        <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <p className="font-semibold text-amber-800">Ordering is disabled</p>
          <p className="mt-1 text-sm text-amber-700">
            Marketplace ordering is currently off — customers order directly
            from each restaurant through its own menu link, so tracking lives
            there too.
          </p>
        </div>
      )}

      {notFound && !order && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <p className="font-semibold text-slate-900">Order not found</p>
          <p className="mt-1 text-sm text-slate-500">
            We couldn&apos;t find an order with that reference. Double-check
            the link — every order has a permanent URL like /orders/
            {reference}.
          </p>
        </div>
      )}

      {loadError === "server" && !order && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <p className="font-semibold text-rose-700">
            We couldn&apos;t load your order
          </p>
          <p className="mt-1 text-sm text-rose-600">
            Something went wrong on our end. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={loading}
            className="mt-4 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      )}

      {loadError === "network" && !order && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <p className="font-semibold text-slate-900">
            We couldn&apos;t load your order
          </p>
          <p className="mt-1 text-sm text-slate-500">
            There seems to be a network problem. Please check your connection
            and try again.
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={loading}
            className="mt-4 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      )}

      <RefreshWarning
        visible={Boolean(refreshError) && order !== null}
        lastUpdatedAt={lastUpdatedAt}
        busy={refreshing}
        onRetry={refresh}
      />

      {order && (
        <LiveTracker
          order={order}
          brand={brand}
          cancelling={cancelling}
          cancelError={cancelError}
          onCancel={cancelOrder}
        />
      )}
    </div>
  );
}

/**
 * Phase 26 — a transient refresh failure never destroys the page. The order
 * (and its status) stays rendered, polling keeps going, and this banner gives
 * an honest staleness line plus a manual Retry. It clears on the next
 * successful fetch.
 */
function RefreshWarning({
  visible,
  lastUpdatedAt,
  busy,
  onRetry,
}: {
  visible: boolean;
  lastUpdatedAt: number | null;
  busy: boolean;
  onRetry: () => Promise<void>;
}) {
  if (!visible) return null;
  return (
    <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <span aria-hidden className="mt-0.5 text-sm text-amber-600">
        ⚠
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900">
          Couldn&apos;t refresh
        </p>
        <p className="mt-0.5 text-xs text-amber-700">
          Last updated {timeAgo(lastUpdatedAt) || "a moment ago"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={busy}
        className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
      >
        {busy ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

/**
 * Phase 10 — status-specific hero copy. Titles/details are the customer-facing
 * messages; the canonical lifecycle label (src/lib/order-lifecycle.ts
 * statusLabel) still drives every other status display (rails, stepper, chips).
 */
const STATUS_MESSAGES: Record<string, { title: string; detail: string }> = {
  placed: {
    title: "Order received",
    detail: "We’re waiting for the restaurant to accept your order.",
  },
  accepted: {
    title: "Order accepted",
    detail: "The restaurant has accepted your order.",
  },
  preparing: {
    title: "Preparing your order",
    detail: "The kitchen is working on it now.",
  },
  ready: {
    title: "Your order is ready",
    detail: "It’s ready for pickup / delivery.",
  },
  completed: {
    title: "Order completed",
    detail: "Enjoy your meal!",
  },
  cancelled: {
    title: "Order cancelled",
    detail: "This order has been cancelled.",
  },
};

function LiveTracker({
  order,
  brand,
  cancelling,
  cancelError,
  onCancel,
}: {
  order: PublicOrder;
  brand: OrderTracking["brand"];
  cancelling: boolean;
  cancelError: string | null;
  onCancel: () => Promise<void>;
}) {
  const { restaurant, lifecycle, placedAt } = order;
  const name = brand?.name ?? restaurant.name;
  const logo = brand?.logoUrl;
  const message = STATUS_MESSAGES[lifecycle.status] ?? STATUS_MESSAGES.placed;

  return (
    <div key={order.reference}>
      {/* ── Premium header: logo, name, YOUR ORDER, reference ────────── */}
      <header className="mt-8 flex flex-col items-center text-center sm:mt-10">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={name}
            className="grid h-20 w-20 place-items-center rounded-2xl border border-slate-200 bg-white object-contain p-2 shadow-sm"
          />
        ) : (
          <span className="grid h-20 w-20 place-items-center rounded-2xl bg-orange-500 text-3xl font-bold text-white shadow-sm">
            {name.charAt(0).toUpperCase()}
          </span>
        )}

        <Link
          href={`/restaurants/${restaurant.slug}`}
          className="mt-4 text-lg font-bold tracking-tight text-slate-900 hover:text-orange-600"
        >
          {name}
        </Link>

        <div className="mt-1 flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Your order
          </p>
          {!lifecycle.terminal && (
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              LIVE
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-sm font-semibold text-slate-500">
          #{order.reference}
        </p>
        <p className="mt-1 text-xs text-slate-400">{shortDate(placedAt)}</p>
      </header>

      {/* ── Status hero card ─────────────────────────────────────────── */}
<section
        className={`mt-6 rounded-3xl p-6 text-center shadow-sm transition-colors duration-500 sm:mt-8 sm:p-8 ${
          lifecycle.status === "cancelled"
            ? "bg-rose-50"
            : lifecycle.status === "completed"
              ? "bg-emerald-50"
              : "bg-gradient-to-br from-orange-50 to-amber-50"
        }`}
      >
        <p
          className={`mx-auto w-fit rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors duration-500 ${
            lifecycle.status === "cancelled"
              ? "bg-rose-200/60 text-rose-700"
              : lifecycle.status === "completed"
                ? "bg-emerald-200/60 text-emerald-700"
                : "bg-orange-200/60 text-orange-700"
          }`}
        >
          {lifecycle.label}
        </p>
        <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 transition-all duration-500 sm:text-3xl">
          {message.title}
        </p>
        {message.detail && (
          <p className="mt-2 text-sm text-slate-600 sm:text-base">{message.detail}</p>
        )}
      </section>

      {/* ── Horizontal progress rail ─────────────────────────────────── */}
      <div
        key={`rail-${lifecycle.step}`}
        className="mt-6 animate-[fadeInUp_0.5s_ease-out] sm:mt-8"
      >
        <ProgressRail step={lifecycle.step} />
      </div>

      {/* ── Vertical status detail (desktop only — mobile keeps the rail
              as the primary status read) ─────────────────────────────── */}
      <div className="mt-8 hidden rounded-2xl border border-slate-200 bg-white p-5 sm:block sm:p-6">
        <VerticalStepTracker step={lifecycle.step} />
      </div>

      {/* Cancellation window — Phase 19: only while `status === placed`.
          The value comes from the API's lifecycle summary (the backend owns
          the rule); the POST itself is still validated server-side. */}
      {lifecycle.status === "placed" && (
        <OrderCancelButton
          busy={cancelling}
          error={cancelError}
          onCancel={onCancel}
        />
      )}

      <OrderTimeline events={order.timeline} />

      <OrderDetails order={order} />

      <PaymentStatus payment={order.payment} total={order.totals.total} />
    </div>
  );
}

/**
 * Horizontal premium progress rail:
 *
 *   ●────●────●────○────○
 *   Placed Accepted Preparing Ready Completed
 *
 * Node index comes from order-lifecycle.ts (stepIndex), never re-implemented.
 */
function ProgressRail({ step }: { step: number }) {
  return (
    <div className="px-2">
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step && !done;
          return (
            <div key={s} className="flex flex-1 items-center last:flex-none">
              <span
                className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold transition-all duration-300 ${
                  done
                    ? "bg-orange-500 text-white"
                    : current
                      ? "bg-orange-100 text-orange-600 ring-2 ring-orange-500"
                      : "border border-slate-200 bg-white text-slate-400"
                }`}
              >
                {done ? "✓" : current ? "●" : "○"}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={`mx-1 h-0.5 min-w-0 flex-1 rounded transition-colors duration-300 ${
                    done ? "bg-orange-500" : "bg-slate-200"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step && !done;
          return (
            <span
              key={s}
              className={`flex-1 text-center text-[10px] font-semibold leading-tight last:flex-none ${
                done || current ? "text-slate-900" : "text-slate-400"
              }`}
            >
              {statusLabel(s)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Vertical order status flow:
 *
 *   ✓ Placed
 *   │
 *   ✓ Accepted
 *   │
 *   ● Preparing   ← active
 *   │
 *   ○ Ready
 *   │
 *   ○ Completed
 *
 * Step index comes from src/lib/order-lifecycle.ts (stepIndex), so this UI
 * never re-implements the status order.
 */
function VerticalStepTracker({ step }: { step: number }) {
  return (
    <ol className="max-w-sm">
      {STEPS.map((s, i) => {
        const done = i < step;
        const current = i === step && !done;
        const last = i === STEPS.length - 1;
        return (
          <li key={s} className="relative flex gap-4 pb-8 last:pb-0">
            {/* Connector line beneath the node (skipped for the final step). */}
            {!last && (
              <span
                aria-hidden
                className={`absolute left-[13px] top-7 h-full w-0.5 ${
                  done ? "bg-orange-500" : "bg-slate-200"
                }`}
              />
            )}

            {/* Node */}
            <span
              className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                done
                  ? "bg-orange-500 text-white"
                  : current
                    ? "bg-orange-100 text-orange-600 ring-2 ring-orange-500"
                    : "border border-slate-200 bg-white text-slate-400"
              }`}
            >
              {done ? "✓" : current ? "●" : "○"}
            </span>

            {/* Label */}
            <span
              className={`pt-1 text-sm font-semibold leading-tight ${
                done || current ? "text-slate-900" : "text-slate-400"
              }`}
            >
              {statusLabel(s)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}