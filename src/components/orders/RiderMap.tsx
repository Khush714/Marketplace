"use client";

import { useEffect, useRef } from "react";
import type { LatLng } from "@/lib/geo";
import { haversineKm, formatDistance } from "@/lib/geo";
import type { RiderFix } from "@/lib/delivery";
import "leaflet/dist/leaflet.css";

/**
 * PHASE 30 — live delivery map for the customer tracker.
 *
 * Renders the restaurant pickup pin, the checkout-captured dropoff pin and
 * the rider's live position on a Leaflet/OpenStreetMap base. The rider marker
 * is updated via `setLatLng` on each SSE fix; a CSS transition on the Leaflet
 * icon element makes the marker glide between fixes instead of teleporting.
 *
 * Leaflet is side-stepping the module graph during render (it needs real DOM),
 * so the map is built imperatively once the container mounts, and markers are
 * kept in refs. The component is data-only — the live `rider` fix comes down
 * from the tracker via props.
 */

const SPEED_KMH: Record<string, number> = {
  walking: 5,
  bike: 25,
  scooter: 35,
  car: 40,
};

/** Straight-line ETA with a 1.3 road-compensation factor (display-only). */
function etaMinutes(km: number, vehicleType?: string | null): number {
  const kmh = SPEED_KMH[vehicleType ?? "bike"] ?? SPEED_KMH.bike;
  return Math.max(1, Math.round((km * 1.3 * 60) / kmh));
}

function pin(background: string, emoji: string, size = 28): string {
  return `
    <div style="width:${size}px;height:${size}px;border-radius:9999px;background:${background};border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:grid;place-items:center;font-size:${Math.round(size * 0.55)}px;line-height:1">
      ${emoji}
    </div>`;
}

function riderPin(): string {
  return `
    <div style="position:relative;width:24px;height:24px">
      <span style="position:absolute;inset:0;border-radius:9999px;background:rgba(255,122,26,.5);animation:riderPing 1.6s ease-out infinite"></span>
      <span style="position:absolute;inset:3px;border-radius:9999px;background:#ff7a1a;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45)"></span>
    </div>`;
}

export type RiderMapProps = {
  restaurant: { name: string; lat: number | null; lng: number | null };
  dropoff: LatLng | null;
  rider: RiderFix | null;
  vehicleType?: string | null;
};

export function RiderMap({ restaurant, dropoff, rider, vehicleType }: RiderMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const restMarker = useRef<import("leaflet").Marker | null>(null);
  const dropMarker = useRef<import("leaflet").Marker | null>(null);
  const riderMarker = useRef<import("leaflet").Marker | null>(null);
  const routeRef = useRef<import("leaflet").Polyline | null>(null);
  const fittedRider = useRef(false);

  const restaurantPin = restaurant.lat != null && restaurant.lng != null;

  // Build the map + static pins once the container exists. Static inputs
  // (restaurant/dropoff) never change for a given order, so capture-once is
  // intentional; rider movements arrive through the separate effect below.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let disposed = false;
    let attempts = 0;
    let retryTimer: number | undefined;

    const initMap = (L: typeof import("leaflet")) => {
      if (disposed || !el) return;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Container had no size at mount (e.g. rendered while hidden or below
        // the fold on mobile). Retry briefly once it has real dimensions so
        // the map isn't silently dropped.
        if (attempts < 10) {
          attempts += 1;
          retryTimer = window.setTimeout(() => {
            void import("leaflet").then((L2) => initMap(L2));
          }, 120);
        }
        return;
      }

      const map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false,
        dragging: true,
      });
      map.setView([restaurant.lat ?? 0, restaurant.lng ?? 0], 14);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const hasRest = restaurant.lat != null && restaurant.lng != null;
      const rest: LatLng | null = hasRest
        ? { lat: restaurant.lat as number, lng: restaurant.lng as number }
        : null;
      const pts: LatLng[] = [];
      if (rest) {
        restMarker.current = L.marker([rest.lat, rest.lng], {
          icon: L.divIcon({
            className: "",
            html: pin("#fff7ed", "🍽"),
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
          zIndexOffset: 200,
        }).addTo(map);
        pts.push(rest);
      }
      if (dropoff) {
        dropMarker.current = L.marker([dropoff.lat, dropoff.lng], {
          icon: L.divIcon({
            className: "",
            html: pin("#ecfdf5", "📍"),
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
          zIndexOffset: 200,
        }).addTo(map);
        pts.push(dropoff);
      }
      if (rider) {
        riderMarker.current = L.marker([rider.lat, rider.lng], {
          icon: L.divIcon({
            className: "",
            html: riderPin(),
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
          zIndexOffset: 1000,
        }).addTo(map);
        fittedRider.current = true;
        pts.push({ lat: rider.lat, lng: rider.lng });
      }

      if (pts.length > 0) {
        map.fitBounds(L.latLngBounds(pts.map((p) => L.latLng(p.lat, p.lng))), {
          padding: [36, 36],
        });
      }

      // Let the rider pin pulse; scoped to this map instance.
      const style = document.createElement("style");
      style.textContent = `
        [data-rider-map] .leaflet-marker-icon{transition:transform .9s linear}
        @keyframes riderPing{0%{transform:scale(.6);opacity:.9}100%{transform:scale(2.1);opacity:0}}
      `;
      el.appendChild(style);
    };

    void import("leaflet").then((L) => initMap(L));

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      mapRef.current?.remove();
      mapRef.current = null;
      restMarker.current = null;
      dropMarker.current = null;
      riderMarker.current = null;
      routeRef.current = null;
      fittedRider.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the rider: create the marker + route on first fix, then glide.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!rider) return;

    const pickup: LatLng | null =
      restaurant.lat != null && restaurant.lng != null
        ? { lat: restaurant.lat, lng: restaurant.lng }
        : null;

    void import("leaflet").then((L) => {
      const mapNow = mapRef.current;
      if (!mapNow) return;

      // Marker — create on first fix with a one-time fit-to-bounds, then just
      // move it on every subsequent fix (CSS transition glides the icon).
      if (!riderMarker.current) {
        riderMarker.current = L.marker([rider.lat, rider.lng], {
          icon: L.divIcon({
            className: "",
            html: riderPin(),
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
          zIndexOffset: 1000,
        }).addTo(mapNow);
        const pts: LatLng[] = [];
        if (pickup) pts.push(pickup);
        if (dropoff) pts.push(dropoff);
        pts.push({ lat: rider.lat, lng: rider.lng });
        if (!fittedRider.current) {
          fittedRider.current = true;
          mapNow.fitBounds(
            L.latLngBounds(pts.map((p) => L.latLng(p.lat, p.lng))),
            { padding: [36, 36] },
          );
        }
      } else {
        riderMarker.current.setLatLng([rider.lat, rider.lng]);
      }

      // PHASE 10 — route polyline (restaurant → rider → dropoff). Straight-line
      // segments with dashed "road" styling; updated on each fix. Created on
      // first sighting of the rider, glides as the rider marker moves.
      const routePts = [pickup, { lat: rider.lat, lng: rider.lng }, dropoff]
        .filter((p): p is LatLng => p !== null)
        .map((p) => L.latLng(p.lat, p.lng));
      if (routePts.length >= 2) {
        if (!routeRef.current) {
          routeRef.current = L.polyline(routePts, {
            color: "#ff7a1a",
            weight: 3,
            opacity: 0.55,
            dashArray: "2 7",
            interactive: false,
          }).addTo(mapNow);
          routeRef.current.bringToBack();
        } else {
          routeRef.current.setLatLngs(routePts);
        }
      }
    });
  }, [rider, dropoff, restaurant.lat, restaurant.lng]);

  const canDraw = restaurantPin && Boolean(dropoff);

  if (!canDraw) {
    return (
      <div className="rounded-3xl border border-white/8 bg-ink-850 p-4 text-center text-xs text-white/40">
        Live map isn&apos;t available for this order yet.
      </div>
    );
  }

  const km =
    rider && dropoff ? haversineKm({ lat: rider.lat, lng: rider.lng }, dropoff) : null;

  return (
    <div data-rider-map className="card-lift overflow-hidden rounded-3xl border border-white/8 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      {km !== null && (
        <div className="flex items-center justify-between border-b border-white/6 bg-ink-900/60 px-4 py-2.5">
          <p className="text-xs font-bold text-white">
            {formatDistance(km)} away
          </p>
          <p className="text-xs text-white/45">
            ~{etaMinutes(km, vehicleType)} min
          </p>
        </div>
      )}
      <div
        ref={containerRef}
        aria-label={`Live map: ${restaurant.name} to your delivery location`}
        className="z-0 h-60 w-full"
      />
    </div>
  );
}