"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicOrder } from "@/lib/marketplace";

/**
 * Customer-side order tracking.
 *
 *   reference
 *      ↓
 *   GET /api/marketplace/orders/:reference     (owned by the backend)
 *      ↓
 *   PublicOrder → React state
 *
 * PHASE 11 + 12 + 13 + 14 — REST polling, 5s tick while the order is live:
 *
 *   Initial GET → render → wait 5s → GET → compare status → update UI (only
 *   when changed) → wait 5s → repeat.
 *
 *   • STOP when the API's `lifecycle.terminal` is true (completed / cancelled
 *     — the backend defines terminality, never a frontend hardcode).
 *   • Exactly ONE interval per tracked reference. It is never re-created on a
 *     status change (status changes keep `live` true, so the same loop keeps
 *     polling); it is cleaned up on unmount, on reference change, and when the
 *     order becomes terminal.
 *   • Background tabs: ticks are skipped while hidden (no aggressive polling),
 *     and `visibilitychange → visible` triggers an immediate refresh so the
 *     tracker catches up the moment the customer returns.
 *   • No polling at all when there is no order to track (not found, ordering
 *     disabled, initial load errors) or when the reference is empty.
 *
 * All lifecycle knowledge lives in src/lib/order-lifecycle.ts — this hook
 * never re-implements status rules, it only asks the API.
 */

const POLL_MS = 5000;

export type RestaurantBrand = {
  name: string;
  logoUrl: string;
  slug: string;
};

export type OrderTracking = {
  order: PublicOrder | null;
  /** Restaurant branding (logo for the premium header). */
  brand: RestaurantBrand | null;
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
  orderRef.current = order;
  brandRef.current = brand;

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
      const prev = orderRef.current;

      // Phase 11 — compare then update: identical status/step/timeline means
      // nothing moved, so skip the re-render (avoid polling-driven churn).
      const changed =
        !prev ||
        !next ||
        prev.status !== next.status ||
        prev.lifecycle.step !== next.lifecycle.step ||
        prev.timeline.length !== next.timeline.length;

      if (changed) {
        setOrder(next);
        orderRef.current = next;
      }
      if (next && (changed || !brandRef.current)) {
        const r = next.restaurant;
        if (r) {
          // Bonus branding read from the existing (non-frozen) restaurant
          // endpoint so the premium header can show the logo.
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
        }
      } else if (!next) {
        setBrand(null);
        brandRef.current = null;
      }
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
  }, []);

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

  // ONE polling loop (Phase 12 + 13). Liveness comes straight from the API's
  // `terminal` flag — the backend owns what is terminal (completed/cancelled,
  // mapped legacy states). The interval is created exactly once per tracked
  // reference+liveness combination and is ALWAYS cleaned up when the component
  // unmounts, the reference changes, or the order becomes terminal.
  // Phase 14 — ticks are skipped while the tab is hidden (no aggressive
  // background polling); visibilitychange refreshes on return (below).
  const live = order !== null && !order.lifecycle.terminal;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (document.hidden) return;
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

  return {
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
  };
}