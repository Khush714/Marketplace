"use client";

import Link from "next/link";
import {
  CONTRACT_STATUS,
  legacyToCanonical,
  ORDER_MAINLINE,
  statusLabel,
  type OrderLifecycleStatus,
} from "@/lib/order-lifecycle";
import { shortDate, shortDateTime, timeAgo } from "@/lib/format";
import { formatDistance, haversineKm, type LatLng } from "@/lib/geo";
import type { RiderFix } from "@/lib/delivery";
import { useOrderTracking } from "@/hooks/useOrderTracking";
import type { OrderTracking } from "@/hooks/useOrderTracking";
import type { PublicOrder } from "@/lib/marketplace";
import { OrderCancelButton } from "./OrderCancelButton";
import { OrderDetails } from "./OrderDetails";
import { OrderTimeline } from "./OrderTimeline";
import { OrderTypeInfo } from "./OrderTypeInfo";
import { DeliveryTracker } from "./DeliveryTracker";
import { RiderMap } from "./RiderMap";
import { PaymentStatus } from "./PaymentStatus";
import { OrderSkeleton } from "./OrderSkeleton";
import { ArrowLeftIcon } from "@/components/ui/icons";

// PHASE 9 — the rail is driven by the lifecycle's own mainline, never a local
// copy. Changing the contract in src/lib/order-lifecycle.ts re-renders here.
const STEPS = ORDER_MAINLINE as unknown as OrderLifecycleStatus[];

export function OrderTracker({ reference }: { reference: string }) {
  const {
    order,
    brand,
    riderLocation,
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
          className="inline-flex items-center gap-1.5 text-sm text-white/45 transition-colors hover:text-ember-400"
        >
          <ArrowLeftIcon className="text-base" /> Home
        </Link>
      </nav>

      {/* Desktop chrome — mobile keeps the reference inside the card. */}
      <h1 className="mt-4 hidden text-center text-2xl font-semibold tracking-tight text-white sm:block">
        Order Tracker
      </h1>

      {loading && !order && !loadError && <OrderSkeleton />}

      {orderingDisabled && !order && (
        <div className="mt-6 rounded-3xl border border-amber-500/20 bg-amber-500/10 p-6">
          <p className="font-semibold text-amber-400">Ordering is disabled</p>
          <p className="mt-1 text-sm text-amber-400/70">
            Marketplace ordering is currently off — customers order directly
            from each restaurant through its own menu link, so tracking lives
            there too.
          </p>
        </div>
      )}

      {notFound && !order && (
        <div className="card-lift mt-6 rounded-3xl border border-white/8 bg-ink-850 p-6 text-center shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <p className="font-semibold text-white">Order not found</p>
          <p className="mt-1 text-sm text-white/45">
            We couldn&apos;t find an order with that reference. Double-check
            the link — every order has a permanent URL like /orders/
            {reference}.
          </p>
        </div>
      )}

      {loadError === "server" && !order && (
        <div className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 text-center">
          <p className="font-semibold text-rose-400">
            We couldn&apos;t load your order
          </p>
          <p className="mt-1 text-sm text-rose-400/80">
            Something went wrong on our end. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={loading}
            className="mt-4 rounded-2xl bg-rose-500 px-5 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-rose-400 disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      )}

      {loadError === "network" && !order && (
        <div className="card-lift mt-6 rounded-3xl border border-white/8 bg-ink-850 p-6 text-center shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <p className="font-semibold text-white">
            We couldn&apos;t load your order
          </p>
          <p className="mt-1 text-sm text-white/45">
            There seems to be a network problem. Please check your connection
            and try again.
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={loading}
            className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
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
          riderLocation={riderLocation}
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
    <div className="mt-6 flex items-start gap-3 rounded-3xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
      <span aria-hidden className="mt-0.5 text-sm text-amber-400">
        ⚠
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-400">
          Couldn&apos;t refresh
        </p>
        <p className="mt-0.5 text-xs text-amber-400/70">
          Last updated {timeAgo(lastUpdatedAt) || "a moment ago"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={busy}
        className="shrink-0 rounded-xl border border-amber-500/25 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-400 transition-colors hover:bg-amber-500/25 disabled:opacity-60"
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
  picked_up: {
    title: "On the way",
    detail: "Your order has been picked up and is heading to you.",
  },
  delivered: {
    title: "Order delivered",
    detail: "Enjoy your meal!",
  },
  cancelled: {
    title: "Order cancelled",
    detail: "This order has been cancelled.",
  },
  rejected: {
    title: "Order not accepted",
    detail: "The restaurant couldn’t take this order. Please try again.",
  },
};

function LiveTracker({
  order,
  brand,
  riderLocation,
  cancelling,
  cancelError,
  onCancel,
}: {
  order: PublicOrder;
  brand: OrderTracking["brand"];
  riderLocation: OrderTracking["riderLocation"];
  cancelling: boolean;
  cancelError: string | null;
  onCancel: () => Promise<void>;
}) {
  const { restaurant, lifecycle, placedAt } = order;
  const name = brand?.name ?? restaurant.name;
  const logo = brand?.logoUrl;
  let message = STATUS_MESSAGES[lifecycle.status] ?? STATUS_MESSAGES.placed;
  // PHASE 29+45 — delivery rides the same lifecycle, but the rider leg
  // deserves its own hero copy while live. Statuses flow through the
  // canonical delivery lifecycle in src/lib/delivery-status.ts.
  const delivery = order.delivery;
  if (delivery && !lifecycle.terminal) {
    const riderName = delivery.partner?.name ?? "Your rider";
    if (delivery.status === "assigned") {
      message = {
        title: "Driver assigned",
        detail: `${riderName} has been assigned. They're on the way to the restaurant.`,
      };
    } else if (delivery.status === "accepted") {
      message = {
        title: "Rider en route",
        detail: `${riderName} is heading to the restaurant.`,
      };
    } else if (delivery.status === "at_restaurant") {
      message = {
        title: "Rider at the restaurant",
        detail: `${riderName} is picking up your order.`,
      };
    } else if (delivery.status === "picked_up") {
      message = {
        title: "Order picked up",
        detail: `${riderName} has your order.`,
      };
    } else if (delivery.status === "out_for_delivery") {
      message = {
        title: "On the way",
        detail: `${riderName} is bringing your order to you.`,
      };
    } else if (delivery.status === "arriving") {
      message = {
        title: "Arriving soon",
        detail: `${riderName} is almost at your door.`,
      };
    } else if (delivery.status === "delivered") {
      message = {
        title: "Order delivered",
        detail: "Enjoy your meal!",
      };
    }
  }

  // PHASE 32 — a future scheduled window overrides the "LIVE now" messaging:
  // the order is booked, not moving yet. Once the window passes the tracker
  // resumes its normal live copy (and the rider can mark it delivered).
  const scheduledAt = order.scheduledFor ? new Date(order.scheduledFor) : null;
  const windowFuture = scheduledAt ? scheduledAt.getTime() > Date.now() : false;
  if (windowFuture && scheduledAt) {
    message = {
      title: "Order scheduled",
      detail: `Scheduled for ${shortDateTime(scheduledAt)} — we'll keep you posted.`,
    };
  }

  return (
    <div key={order.reference}>
      {/* ── Premium header: logo, name, YOUR ORDER, reference ────────── */}
      <header className="mt-8 flex flex-col items-center text-center sm:mt-10">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={name}
            className="grid h-20 w-20 place-items-center rounded-3xl border border-white/10 bg-ink-850 object-contain p-2 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
          />
        ) : (
          <span className="grid h-20 w-20 place-items-center rounded-3xl bg-ember-500 text-3xl font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)]">
            {name.charAt(0).toUpperCase()}
          </span>
        )}

        <Link
          href={`/restaurants/${restaurant.slug}`}
          className="mt-4 text-lg font-bold tracking-tight text-white transition-colors hover:text-ember-400"
        >
          {name}
        </Link>

        <div className="mt-1 flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            Your order
          </p>
          {!lifecycle.terminal &&
            (windowFuture ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-sky-400">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                SCHEDULED
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                LIVE
              </span>
            ))}
        </div>
        <p className="mt-1 font-mono text-sm font-semibold text-white/50">
          #{order.reference}
        </p>
        <p className="mt-1 text-xs text-white/35">{shortDate(placedAt)}</p>
      </header>

      {/* ── Scheduled window banner (PHASE 32) ───────────────────────── */}
      {scheduledAt && windowFuture && (
        <section className="card-lift mt-6 rounded-3xl border border-sky-400/20 bg-sky-400/10 px-5 py-4 text-center shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] sm:mt-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-sky-400">
            Scheduled delivery window
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-white">
            {shortDateTime(scheduledAt)}
          </p>
        </section>
      )}

      {/* ── Status hero card ─────────────────────────────────────────── */}
      <section
        className={`card-lift mt-6 rounded-3xl p-6 text-center shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-colors duration-500 sm:mt-8 sm:p-8 ${
          lifecycle.status === "cancelled" || lifecycle.status === "rejected"
            ? "border border-rose-500/20 bg-rose-500/10"
            : lifecycle.status === "delivered"
              ? "border border-emerald-400/20 bg-emerald-400/10"
              : "border border-white/8 bg-gradient-to-br from-ember-500/20 via-ink-850 to-ink-900"
        }`}
      >
        <p
          className={`mx-auto w-fit rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors duration-500 ${
            lifecycle.status === "cancelled" || lifecycle.status === "rejected"
              ? "border-rose-500/25 bg-rose-500/20 text-rose-400"
              : lifecycle.status === "delivered"
                ? "border-emerald-400/25 bg-emerald-400/20 text-emerald-400"
                : "border-ember-500/25 bg-ember-500/15 text-ember-400"
          }`}
        >
          {CONTRACT_STATUS[legacyToCanonical(lifecycle.status)]}
        </p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-white transition-all duration-500 sm:text-3xl">
          {message.title}
        </p>
        {message.detail && (
          <p className="mt-2 text-sm text-white/55 sm:text-base">{message.detail}</p>
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
      <div className="card-lift mt-8 hidden rounded-3xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] sm:block sm:p-6">
        <VerticalStepTracker step={lifecycle.step} />
      </div>

      {/* Cancellation window — PHASE 9: only while `status === accepted`
          (contract edge ACCEPTED → CANCELLED). The value comes from the API's
          lifecycle summary (the backend owns the rule); the POST itself is
          still validated server-side. */}
      {lifecycle.status === "accepted" && (
        <OrderCancelButton
          busy={cancelling}
          error={cancelError}
          onCancel={onCancel}
        />
      )}

      <OrderTimeline events={order.timeline} audit={order.events} />

      <OrderTypeInfo order={order} />

      {order.fulfillment === "delivery" && order.delivery && (
        <div key={`dlv-${order.delivery.status}-${order.delivery.step}`}>
          {order.delivery.dropoff && (
            <div className="mb-4">
              {(order.delivery.status === "out_for_delivery" ||
                order.delivery.status === "arriving") && (
                <LiveDeliveryEta
                  status={order.delivery.status}
                  riderName={order.delivery.partner?.name ?? null}
                  vehicleType={order.delivery.partner?.vehicleType ?? null}
                  rider={riderLocation ?? order.delivery.rider}
                  dropoff={order.delivery.dropoff}
                />
              )}
              <RiderMap
                restaurant={order.restaurant}
                dropoff={order.delivery.dropoff}
                rider={riderLocation}
                vehicleType={order.delivery.partner?.vehicleType}
              />
            </div>
          )}
          <DeliveryTracker delivery={order.delivery} />
        </div>
      )}

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
                    ? "bg-ember-500 text-ink-950"
                    : current
                      ? "bg-ember-500/15 text-ember-400 ring-2 ring-ember-500"
                      : "border border-white/15 bg-ink-850 text-white/40"
                }`}
              >
                {done ? "✓" : current ? "●" : "○"}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={`mx-1 h-0.5 min-w-0 flex-1 rounded transition-colors duration-300 ${
                    done ? "bg-ember-500" : "bg-white/10"
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
                done || current ? "text-white" : "text-white/40"
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
                  done ? "bg-ember-500" : "bg-white/10"
                }`}
              />
            )}

            {/* Node */}
            <span
              className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                done
                  ? "bg-ember-500 text-ink-950"
                  : current
                    ? "bg-ember-500/15 text-ember-400 ring-2 ring-ember-500"
                    : "border border-white/15 bg-ink-850 text-white/40"
              }`}
            >
              {done ? "✓" : current ? "●" : "○"}
            </span>

            {/* Label */}
            <span
              className={`pt-1 text-sm font-semibold leading-tight ${
                done || current ? "text-white" : "text-white/40"
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

const ETA_SPEED_KMH: Record<string, number> = {
  walking: 5,
  bike: 25,
  scooter: 35,
  car: 40,
};

/** Straight-line ETA with a 1.3 road-compensation factor (display only). */
function riderEtaMinutes(km: number, vehicleType?: string | null): number {
  const kmh = ETA_SPEED_KMH[vehicleType ?? "bike"] ?? ETA_SPEED_KMH.bike;
  return Math.max(1, Math.round((km * 1.3 * 60) / kmh));
}

/**
 * PHASE 9/13 — "LIVE DELIVERY" ETA strip on the customer card once the rider
 * is on the road (out_for_delivery / arriving). Distance and ETA are computed
 * from the live fix — never a hardcoded number.
 */
function LiveDeliveryEta({
  status,
  riderName,
  vehicleType,
  rider,
  dropoff,
}: {
  status: string;
  riderName: string | null;
  vehicleType: string | null;
  rider: RiderFix | null;
  dropoff: LatLng;
}) {
  if (!rider) return null;
  const km = haversineKm({ lat: rider.lat, lng: rider.lng }, dropoff);
  const eta = riderEtaMinutes(km, vehicleType);
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-ember-500/20 bg-ember-500/10 px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm font-bold text-white">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ember-500/15 text-[13px] leading-none">
          {status === "arriving" ? "🏠" : "🛵"}
        </span>
        {riderName ?? "Your rider"}
        <span className="font-medium text-white/45">
          {status === "arriving" ? "is arriving" : "is on the way"}
        </span>
      </p>
      <p className="shrink-0 text-right text-xs font-bold tabular-nums text-ember-400">
        {formatDistance(km)} · ~{eta} min
      </p>
    </div>
  );
}