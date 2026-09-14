"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicOrder } from "@/lib/marketplace";
import type { RiderFix } from "@/lib/delivery";

/**
 * Customer-side order tracking.
 *
 *   reference
 *      ↓
 *   GET /api/marketplace/orders/:reference     (owned by the backend)
 *      ↓
 *   PublicOrder → React state
 *
 * PHASE 28 — transport is a Server-Sent Events stream first, REST polling as
 * the durability net:
 *
 *   • EventSource → /api/marketplace/orders/:reference/events
 *     └ events `order` push a full PublicOrder snapshot on every change and
 *       `close` signals a terminal order. While the stream is open the client
 *       is event-driven (near-zero latency, no polling).
 *   • The existing 5s REST poll downgrades to a 30s reconciliation tick when
 *     the stream is open, and resumes 5s cadence the moment the stream errors
 *     or is unsupported — so a flaky connection can never stall the tracker.
 *   • EventSource auto-reconnects on network blips; the server resends the
 *     current snapshot on every (re)connect, keeping the client fresh.
 *
 * The REST loop retains all Phase 11–14 semantics:
 *   Initial GET → render → wait → GET → compare status → update UI (only when
 *   changed) → repeat.
 *
 *   • STOP when the API's `lifecycle.terminal` is true (delivered / cancelled /
 *     rejected)
 *     — the backend defines terminality, never a frontend hardcode).
 *   • Exactly ONE poll interval + ONE EventSource per tracked reference. They
 *     are cleaned up on unmount, on reference change, and when the order
 *     becomes terminal.
 *   • Background tabs: poll ticks are skipped while hidden (no aggressive
 *     polling) and `visibilitychange → visible` triggers an immediate refresh.
 *   • No streaming/polling at all when there is no order to track.
 *
 * All lifecycle knowledge lives in src/lib/order-lifecycle.ts — this hook
 * never re-implements status rules, it only asks the API.
 */

const POLL_MS = 5000;
const RECONCILE_MS = 30_000;
const LOCATION_POLL_MS = 15_000;

export type RestaurantBrand = {
  name: string;
  logoUrl: string;
  slug: string;
};

/** SSE transport health — drives the fallback polling cadence. */
type SseState = "idle" | "connecting" | "open" | "error";

export type OrderTracking = {
  order: PublicOrder | null;
  /** Restaurant branding (logo for the premium header). */
  brand: RestaurantBrand | null;
  /**
   * PHASE 30 — latest live rider position fix. Arrives via the SSE `rider`
   * event family (lightweight, never re-renders the order rail) and via a
   * 15s REST fallback while the stream is down. Null until the rider reports.
   */
  riderLocation: RiderFix | null;
  /** Initial page load in flight (nothing rendered yet). */
  loading: boolean;
  /** A background fetch is in flight (poll tick or manual refresh). */
  refreshing: boolean;
  /**
   * Initial load failed and there is no order to show yet. `Try again`
   * re-runs the initial fetch. This is NOT a failed order — the reference
   * was simply unreachable at that moment.
   */
  loadError: "not_found" | "server" | "network" | null;
  /**
   * A background poll tick failed while we already had an order. The last
   * known order is kept (never dropped) and polling continues (Phase 26: the
   * page is never destroyed by a temporary failure).
   */
  refreshError: "server" | "network" | null;
  /** Timestamp (ms) of the last successful fetch — drives "Last updated …". */
  lastUpdatedAt: number | null;
  notFound: boolean;
  orderingDisabled: boolean;
  /** POSTs to the cancel endpoint; refreshes the order on success. */
  cancelOrder: () => Promise<void>;
  cancelling: boolean;
  cancelError: string | null;
  /** Re-runs the initial fetch (used by "Try again"). */
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
};

/** True when a request error means the initial load has failed outright. */
function isRequestAborted(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /abort|network/i.test(err.message))
  );
}

export function useOrderTracking(reference: string): OrderTracking {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [brand, setBrand] = useState<RestaurantBrand | null>(null);
  const [riderLocation, setRiderLocation] = useState<RiderFix | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<OrderTracking["loadError"]>(null);
  const [refreshError, setRefreshError] =
    useState<OrderTracking["refreshError"]>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [orderingDisabled, setOrderingDisabled] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const ref = useRef(reference);
  // Distinguishes the first fetch (loading) from later refetches (refreshing).
  const loadedOnce = useRef(false);
  // Mirrors of the last rendered order/brand so the poll loop can compare
  // against current state without stale closures (Phase 11: update on change).
  const orderRef = useRef<PublicOrder | null>(null);
  const brandRef = useRef<RestaurantBrand | null>(null);
  const riderRef = useRef<RiderFix | null>(null);
  const sseState = useRef<SseState>("idle");
  orderRef.current = order;
  brandRef.current = brand;
  riderRef.current = riderLocation;

  /**
   * Shared snapshot apply path (poll + SSE). Phase 11 — compare then update:
   * an identical status/step/timeline means nothing moved, so skip the
   * re-render (avoids event/poll-driven churn). Also hydrates the premium
   * header branding from the restaurant endpoint on change.
   */
  const commitOrder = useCallback(async (next: PublicOrder | null) => {
    const prev = orderRef.current;
    const changed =
      !prev ||
      !next ||
      prev.status !== next.status ||
      prev.lifecycle.step !== next.lifecycle.step ||
      prev.timeline.length !== next.timeline.length ||
      // PHASE 29 — delivery updates ride the same snapshot contract.
      prev.delivery?.status !== next.delivery?.status ||
      prev.delivery?.partner?.id !== next.delivery?.partner?.id;

    if (changed) {
      setOrder(next);
      orderRef.current = next;
    }

    // Branding read from the existing (non-frozen) restaurant endpoint.
    const r = next?.restaurant;
    if (next && r && (changed || !brandRef.current)) {
      try {
        const br = await fetch(
          `/api/marketplace/restaurants/${encodeURIComponent(r.id)}`,
        );
        const bd = await br.json().catch(() => null);
        const rp = bd?.restaurant;
        if (rp) {
          const brand = {
            name: rp.name ?? r.name,
            logoUrl: rp.logoUrl ?? "",
            slug: rp.slug ?? r.slug,
          };
          setBrand(brand);
          brandRef.current = brand;
        }
      } catch {
        // Branding is cosmetic — never block tracking on it.
      }
    } else if (!next) {
      setBrand(null);
      brandRef.current = null;
    }
  }, []);

  // PHASE 30 — lightweight rider fix apply path (SSE `rider` event + REST
  // fallback). Compares by fix identity so repeated ticks skip re-renders.
  const commitRider = useCallback((fix: RiderFix | null) => {
    const prev = riderRef.current;
    const key = (f: RiderFix | null) =>
      f ? `${f.lat}:${f.lng}:${f.heading ?? ""}:${f.at}` : "none";
    if (key(prev) === key(fix)) return;
    setRiderLocation(fix);
    riderRef.current = fix;
  }, []);

  const load = useCallback(async () => {
    const current = ref.current;
    if (!current) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const background = loadedOnce.current;
    setOrderingDisabled(false);
    setNotFound(false);
    if (background) {
      setRefreshError(null);
      setRefreshing(true);
    } else {
      setLoadError(null);
      setLoading(true);
    }

    try {
      const res = await fetch(
        `/api/marketplace/orders/${encodeURIComponent(current)}`,
      );
      const data = await res.json().catch(() => null);

      if (res.status === 410) {
        setOrderingDisabled(true);
        setNotFound(false);
        setOrder(null);
        setBrand(null);
        orderRef.current = null;
        brandRef.current = null;
        loadedOnce.current = true;
        return;
      }
      if (res.status === 404) {
        // Initial or mid-tracking: the order no longer resolves. Stop and show
        // not-found rather than marking anything cancelled or failed.
        setNotFound(true);
        setOrder(null);
        setBrand(null);
        orderRef.current = null;
        brandRef.current = null;
        loadedOnce.current = true;
        return;
      }
      if (!res.ok) {
        const err: "server" | "network" = "server";
        if (background) setRefreshError(err);
        else setLoadError(err);
        loadedOnce.current = true;
        return;
      }

      setOrderingDisabled(false);
      setNotFound(false);
      setLastUpdatedAt(Date.now());
      const next = (data?.order ?? null) as PublicOrder | null;
      await commitOrder(next);
      loadedOnce.current = true;
    } catch (e) {
      if (isRequestAborted(e)) return;
      const err: "server" | "network" = "network";
      if (background) setRefreshError(err);
      else setLoadError(err);
      loadedOnce.current = true;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [commitOrder]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  // "Try again" after a failed initial load — resets the flag so it is treated
  // as a fresh first fetch (shows the loading state, not just a background tick).
  const retry = useCallback(async () => {
    loadedOnce.current = false;
    setOrder(null);
    orderRef.current = null;
    await load();
  }, [load]);

  const cancelOrder = useCallback(async () => {
    const current = ref.current;
    if (!current) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(
        `/api/marketplace/orders/${encodeURIComponent(current)}/cancel`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCancelError(data?.error ?? "Could not cancel this order.");
        return;
      }
      // The POS writes the cancellation; refetch so the UI reflects it.
      await load();
    } catch {
      setCancelError("Network error — please try again.");
    } finally {
      setCancelling(false);
    }
  }, [load]);

  useEffect(() => {
    ref.current = reference;
  }, [reference]);

  // Initial load + any time the reference changes.
  useEffect(() => {
    if (!reference) return;
    loadedOnce.current = false;
    setOrder(null);
    orderRef.current = null;
    load();
  }, [reference, load]);

  // ── PHASE 28 — Server-Sent Events ───────────────────────────────────────
  // Open one long-lived stream per tracked reference. The server pushes the
  // order snapshot on every change (event: order) and closes terminal orders
  // (event: close). While the stream is healthy the client relies on pushes;
  // the 5s poll becomes a slow reconciliation cadence (30s). If the stream
  // errors — EventSource auto-reconnects, but in the gap — the poll returns
  // to 5s so the tracker never stalls.
  useEffect(() => {
    ref.current = reference;
    if (!reference) return;
    if (typeof EventSource === "undefined") {
      sseState.current = "error";
      return;
    }

    const es = new EventSource(
      `/api/marketplace/orders/${encodeURIComponent(reference)}/events`,
    );
    sseState.current = "connecting";

    const onOrder = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { order?: PublicOrder };
        if (!data.order) return;
        sseState.current = "open";
        setLoading(false);
        setLoadError(null);
        setNotFound(false);
        setOrderingDisabled(false);
        setLastUpdatedAt(Date.now());
        void commitOrder(data.order);
      } catch {
        /* malformed frame — keep streaming */
      }
    };
    const onClose = () => {
      es.close();
      sseState.current = "idle";
    };
    const onError = () => {
      // Network failure or HTTP error. EventSource reconnects automatically;
      // tighten the poll cadence until it recovers. A genuine 410/404 is
      // surfaced by the REST poll (orderingDisabled / notFound states).
      sseState.current = "error";
    };
    const onRider = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { rider?: RiderFix | null };
        sseState.current = "open";
        commitRider(data.rider ?? null);
      } catch {
        /* malformed frame — keep streaming */
      }
    };

    es.addEventListener("order", onOrder);
    es.addEventListener("rider", onRider);
    es.addEventListener("close", onClose);
    es.addEventListener("error", onError);
    return () => {
      es.removeEventListener("order", onOrder);
      es.removeEventListener("rider", onRider);
      es.removeEventListener("close", onClose);
      es.removeEventListener("error", onError);
      es.close();
      sseState.current = "idle";
    };
  }, [reference, commitOrder, commitRider]);

  // ONE polling loop (Phase 12 + 13). Liveness comes straight from the API's
  // `terminal` flag — the backend owns what is terminal (delivered/cancelled/
  // rejected, plus legacy completed),
  // mapped legacy states). The interval is created exactly once per tracked
  // reference+liveness combination and is ALWAYS cleaned up when the component
  // unmounts, the reference changes, or the order becomes terminal.
  // Phase 14 — ticks are skipped while the tab is hidden (no aggressive
  // background polling); visibilitychange refreshes on return (below).
  // Phase 28 — the cadence adapts to the SSE transport: 5s while the stream is
  // down/connecting ("error" state), 30s reconciliation while it's open.
  const live = order !== null && !order.lifecycle.terminal;
  useEffect(() => {
    if (!live) return;
    let lastPoll = 0;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (sseState.current === "open") {
        const tracked = orderRef.current;
        if (tracked && !tracked.lifecycle.terminal) {
          const now = Date.now();
          if (now - lastPoll >= RECONCILE_MS) {
            lastPoll = now;
            void load();
          }
        }
        return;
      }
      void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, load, reference]);

  // Phase 14 — the customer may lock the phone / switch apps and come back.
  // Refresh immediately when the page becomes visible so the tracker catches
  // up instantly instead of waiting for the next tick.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const tracked = orderRef.current;
      if (tracked && !tracked.lifecycle.terminal) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // PHASE 30 — rider location REST fallback. While the SSE stream is up the
  // server already pushes `rider` events (and self-heals with its own pump),
  // so this only runs when the stream is down/connecting — same moment the
  // order poll tightens to 5s.
  const liveOrder = order !== null && !order.lifecycle.terminal;
  useEffect(() => {
    const current = ref.current;
    if (!current || !liveOrder) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (sseState.current === "open") return;
      void fetch(
        `/api/marketplace/orders/${encodeURIComponent(current)}/location`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && typeof d === "object") {
            commitRider((d as { rider?: RiderFix | null }).rider ?? null);
          }
        })
        .catch(() => {
          /* transient — next tick retries */
        });
    }, LOCATION_POLL_MS);
    return () => clearInterval(id);
  }, [reference, liveOrder, commitRider]);

  return {
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
  };
}