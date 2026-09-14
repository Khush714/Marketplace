"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RiderMap } from "@/components/orders/RiderMap";
import {
  DELIVERY_LABELS,
  deliveryStatusCanonical,
  isDeliveryTerminal,
  type DeliveryStatus,
} from "@/lib/delivery-status";
import { shortDateTime } from "@/lib/format";

/**
 * RIDER PWA console — one screen drives the entire delivery job:
 *
 *   • assignment details (pickup, dropoff, customer, total)
 *   • live map (restaurant → dropoff → the rider's own position)
 *   • continuous GPS reporting (POST location, server rate-limited)
 *   • one-tap status advancement from the canonical next-state list
 *
 * The token is the credential. There is no login/session — the server owns
 * validation, transition rules and idempotency.
 */

type Assignment = {
  token: string;
  status: string;
  label: string;
  next: DeliveryStatus[];
  orderReference: string;
  restaurant: { name: string; address: string };
  customer: { name: string; address: string };
  dropoff: { lat: number; lng: number } | null;
  total: number;
  scheduledFor: string | null;
  rider: { name: string; vehicleType: string } | null;
};

type RiderFix = {
  lat: number;
  lng: number;
  at: string;
};

type GpsState = {
  state: "starting" | "on" | "off" | "unsupported" | "denied" | "error";
  fix: RiderFix | null;
};

const REFRESH_MS = 15_000;

export function RiderConsole({ token }: { token: string }) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [gps, setGps] = useState<GpsState>(() =>
    typeof window !== "undefined" && !window.navigator?.geolocation
      ? { state: "unsupported", fix: null }
      : { state: "starting", fix: null },
  );
  const [toast, setToast] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);

  const status = assignment
    ? deliveryStatusCanonical(assignment.status)
    : null;
  const terminal = status ? isDeliveryTerminal(status) : false;

  // Refresh assignment state periodically (status advanced elsewhere, e.g. admin).
  useEffect(() => {
    let stale = false;
    const id = setInterval(() => {
      if (!document.hidden) setRefreshTick((t) => t + 1);
    }, REFRESH_MS);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/delivery/assignments/${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(data?.error ?? `Request failed (${res.status})`);
        setAssignment(null);
        return;
      }
      setAssignment(data?.assignment ?? null);
      setLoadError(null);
    } catch {
      setLoadError("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // Defer past the effect body so the reload's state updates land async.
    const id = setTimeout(() => void reload(), 0);
    return () => clearTimeout(id);
  }, [reload, refreshTick]);

  // GPS — continuous watch; every fix is POSTed (the server rate-limits).
  const report = useCallback(
    async (lat: number, lng: number) => {
      // Client-side guard mirrors the server's 4s cadence.
      if (Date.now() - lastSentRef.current < 4000) return;
      lastSentRef.current = Date.now();
      try {
        await fetch(`/api/delivery/assignments/${encodeURIComponent(token)}/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        });
      } catch {
        /* next fix retries */
      }
    },
    [token],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.navigator?.geolocation) {
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          at: new Date().toISOString(),
        };
        setGps({ state: "on", fix });
        void report(fix.lat, fix.lng);
      },
      (err) => {
        setGps({
          state: err.code === err.PERMISSION_DENIED ? "denied" : "error",
          fix: null,
        });
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    watchIdRef.current = watchId;
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [report]);

  const advance = useCallback(
    async (toStatus: string) => {
      setAdvancing(true);
      setToast(null);
      try {
        const res = await fetch(
          `/api/delivery/assignments/${encodeURIComponent(token)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toStatus }),
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setToast(data?.error ?? "Could not advance delivery.");
          return;
        }
        setAssignment((prev) =>
          prev
            ? {
                ...prev,
                status: String(data?.assignment?.status ?? toStatus),
                next: (data?.assignment?.next as DeliveryStatus[]) ?? prev.next,
                label: DELIVERY_LABELS[deliveryStatusCanonical(String(data?.assignment?.status ?? toStatus))],
              }
            : prev,
        );
      } catch {
        setToast("Network error — please try again.");
      } finally {
        setAdvancing(false);
      }
    },
    [token],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl pt-10 text-center">
        <p className="text-sm text-white/45">Loading job…</p>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="mx-auto max-w-2xl pt-10">
        <div className="card-lift rounded-3xl border border-white/8 bg-ink-850 p-6 text-center shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
          <p className="font-semibold text-white">Job not found</p>
          <p className="mt-1 text-sm text-white/45">
            This delivery link is invalid or expired. Contact the restaurant
            dispatcher for a new assignment.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void reload();
            }}
            className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Retry
          </button>
        </div>
        {loadError && (
          <p className="mt-2 text-center text-xs text-rose-400">{loadError}</p>
        )}
      </div>
    );
  }

  const canMap =
    assignment.dropoff &&
    (gps.fix || assignment.restaurant);

  return (
    <div className="mx-auto mt-6 max-w-2xl sm:mt-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-3xl bg-ember-500 text-2xl font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)]">
          {assignment.restaurant.name.charAt(0).toUpperCase()}
        </span>
        <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
          Delivery job
        </p>
        <h1 className="mt-0.5 font-mono text-lg font-bold text-white">
          #{assignment.orderReference}
        </h1>
        {!terminal && (
          <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            LIVE
          </span>
        )}
      </header>

      {toast && (
        <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-400">
          {toast}
        </div>
      )}

      {/* ── Status hero ─────────────────────────────────────────────── */}
      <section
        className={`card-lift mt-6 rounded-3xl p-5 text-center shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] ${
          status === "delivered"
            ? "border border-emerald-400/20 bg-emerald-400/10"
            : status === "cancelled" || status === "failed"
              ? "border border-rose-500/20 bg-rose-500/10"
              : "border border-white/8 bg-gradient-to-br from-sky-500/20 via-ink-850 to-ink-900"
        }`}
      >
        <p className="mx-auto w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white/50">
          {assignment.label}
        </p>
        {gps.state === "denied" && (
          <p className="mx-auto mt-2 text-xs text-amber-400">
            Location is blocked — the map won&apos;t update. Enable location
            access in your browser.
          </p>
        )}
        {gps.state === "unsupported" && (
          <p className="mx-auto mt-2 text-xs text-amber-400">
            This browser doesn&apos;t support GPS reporting.
          </p>
        )}
      </section>

      {/* ── Job details ────────────────────────────────────────────── */}
      <section className="card-lift mt-6 space-y-3 rounded-3xl border border-white/8 bg-ink-850 p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ember-500/15 text-xs font-bold text-ember-400">
            P
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
              Pick up
            </p>
            <p className="text-sm font-semibold text-white">
              {assignment.restaurant.name}
            </p>
            <p className="text-xs text-white/45">{assignment.restaurant.address}</p>
          </div>
        </div>
        <div className="ml-4 h-4 w-px bg-gradient-to-b from-ember-500/50 to-emerald-500/50" />
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-400">
            D
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
              Drop off
            </p>
            <p className="text-sm font-semibold text-white">
              {assignment.customer.name}
            </p>
            <p className="text-xs text-white/45">{assignment.customer.address}</p>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/6 pt-3 text-xs">
          <span className="text-white/45">
            {assignment.rider
              ? `${assignment.rider.name} · ${assignment.rider.vehicleType}`
              : "Rider"}
          </span>
          <span className="text-white/45">
            Total {"\u20B9"}
            {assignment.total.toFixed(2)}
          </span>
          {assignment.scheduledFor && (
            <span className="text-sky-400">
              Sched {shortDateTime(new Date(assignment.scheduledFor))}
            </span>
          )}
        </div>
      </section>

      {/* ── Live map ────────────────────────────────────────────────── */}
      {canMap && (
        <div className="mt-6">
          <RiderMap
            restaurant={{
              name: assignment.restaurant.name,
              lat: null,
              lng: null,
            }}
            dropoff={assignment.dropoff}
            rider={gps.fix ?? null}
          />
        </div>
      )}

      {/* ── Advance actions ────────────────────────────────────────── */}
      {!terminal && (
        <section className="mt-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
            Update status
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {assignment.next.map((next) => (
              <button
                key={next}
                type="button"
                disabled={advancing}
                onClick={() => void advance(next)}
                className="rounded-2xl bg-ember-500 px-4 py-2 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
              >
                {advancing ? "…" : DELIVERY_LABELS[next] ?? next}
              </button>
            ))}
            {assignment.next.length === 0 && (
              <p className="text-sm text-amber-400/70">
                No further actions — waiting on the dispatcher.
              </p>
            )}
          </div>
        </section>
      )}

      {gps.fix && (
        <p className="mt-4 text-center text-xs text-white/35">
          Position: {gps.fix.lat.toFixed(5)}, {gps.fix.lng.toFixed(5)} ·{" "}
          {gps.state === "on" ? "live" : gps.state}
        </p>
      )}
    </div>
  );
}