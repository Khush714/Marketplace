"use client";

import { useCallback, useState } from "react";

type WebhookEvent = {
  id: number;
  eventType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string;
  lastHttpStatus: number | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
};

export type DeliveryStatus = {
  orderId: number;
  reference: string;
  restaurantName: string;
  restaurantMarketplaceId: string;
  status: string;
  posDeliveryStatus: string;
  posDeliveryAttempts: number;
  posLastDeliveryError: string;
  posDeliveredAt: string | null;
  integrationProvider: string;
  integrationStatus: string;
  createdAt: string;
  webhookEvents: WebhookEvent[];
};

type Props = {
  delivery: DeliveryStatus;
  onRetry?: (reference: string) => void;
};

const DELIVERY_STYLES: Record<
  string,
  { dot: string; text: string; bg: string; label: string }
> = {
  pending: {
    dot: "bg-white/20",
    text: "text-white/40",
    bg: "bg-white/5",
    label: "Pending",
  },
  queued: {
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Queued",
  },
  delivering: {
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Delivering",
  },
  delivered: {
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Delivered",
  },
  failed: {
    dot: "bg-rose-400",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
    label: "Failed",
  },
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function OrderDeliveryStatus({ delivery, onRetry }: Props) {
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<string | null>(null);

  const style =
    DELIVERY_STYLES[delivery.posDeliveryStatus] || DELIVERY_STYLES.pending;

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryResult(null);
    try {
      const res = await fetch(
        `/api/admin/orders/${delivery.reference}/retry-delivery`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        setRetryResult(data.error ?? "Retry failed");
        return;
      }
      setRetryResult(data.message);
      onRetry?.(delivery.reference);
    } catch {
      setRetryResult("Network error");
    } finally {
      setRetrying(false);
    }
  }, [delivery.reference, onRetry]);

  return (
    <div className="rounded-2xl border border-white/8 bg-ink-850 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-sm font-bold text-white/30">
            {delivery.reference}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {delivery.restaurantName}
            </p>
            <p className="text-xs text-white/35">
              Marketplace ID: {delivery.restaurantMarketplaceId}
            </p>
          </div>
        </div>

        {/* Delivery status badge */}
        <div
          className={`flex items-center gap-2 rounded-xl border border-white/8 ${style.bg} px-3 py-1.5`}
        >
          <span className={`h-2 w-2 rounded-full ${style.dot}`} />
          <span className={`text-xs font-semibold ${style.text}`}>
            {style.label}
          </span>
        </div>
      </div>

      {/* Details grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2">
          <p className="text-[11px] font-medium text-white/35">POS Status</p>
          <p className={`mt-0.5 text-sm font-semibold ${style.text}`}>
            {style.label}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2">
          <p className="text-[11px] font-medium text-white/35">
            Retry Attempts
          </p>
          <p className="mt-0.5 text-sm font-semibold text-white">
            {delivery.posDeliveryAttempts} / 5
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2">
          <p className="text-[11px] font-medium text-white/35">Integration</p>
          <p className="mt-0.5 text-sm font-semibold text-white">
            {delivery.integrationProvider === "restaurantai"
              ? "RestaurantAI"
              : delivery.integrationProvider}
          </p>
          <p
            className={`text-[11px] ${delivery.integrationStatus === "connected" ? "text-emerald-400" : "text-white/30"}`}
          >
            {delivery.integrationStatus === "connected"
              ? "Connected"
              : "Not Connected"}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2">
          <p className="text-[11px] font-medium text-white/35">Placed</p>
          <p className="mt-0.5 text-sm font-semibold text-white">
            {timeAgo(delivery.createdAt)}
          </p>
        </div>
      </div>

      {/* Error message */}
      {delivery.posLastDeliveryError && (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2">
          <p className="text-xs font-medium text-rose-400">
            {delivery.posLastDeliveryError}
          </p>
        </div>
      )}

      {/* Retry button */}
      {delivery.posDeliveryStatus === "failed" && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="rounded-xl bg-ember-500 px-4 py-2 text-xs font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
          >
            {retrying ? "Retrying..." : "Retry Delivery"}
          </button>
          {retryResult && (
            <span className="text-xs text-white/40">{retryResult}</span>
          )}
        </div>
      )}

      {/* Webhook event log */}
      {delivery.webhookEvents.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-medium text-white/35">
            Delivery Log
          </p>
          <div className="mt-1.5 space-y-1.5">
            {delivery.webhookEvents.map((evt) => {
              const evtStyle =
                evt.status === "success"
                  ? "text-emerald-400"
                  : evt.status === "failed"
                    ? "text-rose-400"
                    : evt.status === "retrying"
                      ? "text-amber-400"
                      : "text-white/40";
              return (
                <div
                  key={evt.id}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5"
                >
                  <span className={`text-[11px] font-medium ${evtStyle}`}>
                    {evt.status}
                  </span>
                  <span className="text-[11px] text-white/25">
                    {evt.eventType}
                  </span>
                  <span className="text-[11px] text-white/25">
                    attempt {evt.attempts}/{evt.maxAttempts}
                  </span>
                  {evt.lastHttpStatus ? (
                    <span className="text-[11px] text-white/25">
                      HTTP {evt.lastHttpStatus}
                    </span>
                  ) : null}
                  {evt.lastError && (
                    <span className="truncate text-[11px] text-white/25">
                      {evt.lastError}
                    </span>
                  )}
                  {evt.deliveredAt && (
                    <span className="ml-auto text-[11px] text-emerald-400/60">
                      {timeAgo(evt.deliveredAt)}
                    </span>
                  )}
                  {evt.nextAttemptAt && (
                    <span className="ml-auto text-[11px] text-amber-400/60">
                      next retry {timeAgo(evt.nextAttemptAt)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
