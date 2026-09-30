"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicOrder } from "@/lib/order-public";
import { useProfileOrders, useProfileReady } from "@/lib/profile";
import { experiments } from "@/lib/experiments";

/**
 * Customer-side access to a single order.
 *
 * An order code on its own is not a credential: every read needs the signed
 * token minted at checkout (see lib/order-token), which lives in this browser's
 * profile. That is also why these pages are client components — the token is in
 * localStorage, not in the request, and the server must not be asked for an
 * order it cannot authenticate.
 */

export async function fetchPublicOrder(code: string, token: string): Promise<PublicOrder | null> {
  const res = await fetch(`/api/orders/${encodeURIComponent(code)}`, {
    headers: { "x-order-token": token },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { order?: PublicOrder } | null;
  return data?.order ?? null;
}

export type OrderAccess = "loading" | "ready" | "denied";

function deriveAccess(input: {
  hydrated: boolean;
  token: string | null;
  resultCode: string | null;
  order: PublicOrder | null;
  code: string;
}): OrderAccess {
  if (!input.hydrated) return "loading";
  if (!input.token) return "denied";
  if (input.resultCode !== input.code) return "loading";
  return input.order ? "ready" : "denied";
}

export function usePublicOrder(code: string) {
  const { orders } = useProfileOrders();
  const hydrated = useProfileReady();
  const [result, setResult] = useState<{ code: string; order: PublicOrder | null } | null>(null);

  const token = orders.find((o) => o.code === code)?.token ?? null;

  useEffect(() => {
    if (!hydrated || !token) return;
    let cancelled = false;
    fetchPublicOrder(code, token)
      .then((found) => {
        if (!cancelled) setResult({ code, order: found });
      })
      .catch(() => {
        if (!cancelled) setResult({ code, order: null });
      });
    return () => {
      cancelled = true;
    };
  }, [code, hydrated, token]);

  // Access is derived, not stored: "no token in this browser" and "still
  // fetching" are both knowable during render, so they need no setState and
  // cannot cascade an extra pass.
  const order = result && result.code === code ? result.order : null;
  const access = deriveAccess({ hydrated, token, resultCode: result?.code ?? null, order, code });

  /** Re-read the order (used by the tracking poller). */
  const refresh = useCallback(async () => {
    if (!token) return;
    const found = await fetchPublicOrder(code, token);
    if (found) setResult({ code, order: found });
  }, [code, token]);

  return { order, access, token, refresh };
}

/* ------------------------------------------------------------------ */
/*  Shared polling                                                      */
/* ------------------------------------------------------------------ */

/**
 * Document visibility as state, so a poller or a render loop can be torn down
 * outright while the tab is in the background and rebuilt when it returns.
 *
 * Browsers already throttle timers in hidden tabs, but "throttled" is not
 * "stopped": a 4s interval still fires roughly once a minute, and every one of
 * those is a real request that wakes the radio for a screen nobody is looking
 * at. Gating on this also gives the effect below a dependency it can restart
 * against, which a `document.hidden` read inside the tick could not provide.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    // Sync once on mount: a component can mount into an already-hidden tab, and
    // the initialiser above has to guess to stay SSR-safe.
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * Re-read orders on an interval, with three stops.
 *
 * Both order surfaces used to run a bare `setInterval` that never ended:
 *
 *  - **hidden tab** — the request kept firing in the background. Now gated on
 *    {@link useDocumentVisible}, so a backgrounded route issues nothing.
 *  - **finished order** — a delivered, cancelled or rejected order cannot
 *    change, so polling it is pure waste. `live` is supplied by the caller from
 *    `isOrderLive`, which is the only place that knows the lifecycle, and when
 *    it goes false this effect tears the loop down.
 *  - **overlapping requests** — the next tick is scheduled only after the
 *    previous one settles, so a slow mobile connection cannot stack requests.
 *    That is why this is a recursive `setTimeout` and not a `setInterval`: an
 *    interval would need a separate in-flight flag, and would still fire while
 *    the previous request was outstanding.
 *
 * A rejected or failed request is swallowed and simply retried on the next tick.
 * The caller has already rendered a usable value, so there is nothing to report.
 *
 * `load` and `onData` are held in refs and deliberately absent from the
 * dependency array: they are recreated on every render, and depending on them
 * would restart the loop continuously. The effect depends only on things that
 * should genuinely restart it.
 */export function useOrderPoll<T>({
  load,
  onData,
  intervalMs,
  live,
}: {
  load: () => Promise<T | null>;
  onData: (data: T) => void;
  intervalMs: number;
  live: boolean;
}): void {
  const visible = useDocumentVisible();
  const loadRef = useRef(load);
  const onDataRef = useRef(onData);

  // Keep the refs pointing at the newest closures without listing them as
  // dependencies. Declared *before* the polling effect so that, in the one
  // commit where both run, the refs are already updated when the loop starts.
  useEffect(() => {
    loadRef.current = load;
    onDataRef.current = onData;
  });

  useEffect(() => {
    if (!live || !visible) return;
    // Profiling-only switch (Test E in Phase 13).
    if (experiments.pollingOff()) return;

    let stopped = false;
    let timer = 0;

    const tick = async () => {
      try {
        const data = await loadRef.current();
        if (stopped) return;
        if (data !== null && data !== undefined) onDataRef.current(data);
      } catch {
        /* transient failure — the next tick retries */
      }
      // Scheduled after the await, never before it: this is the whole of the
      // overlap guarantee.
      if (!stopped) timer = window.setTimeout(tick, intervalMs);
    };

    timer = window.setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [intervalMs, live, visible]);
}
