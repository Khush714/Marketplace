"use client";

import Link from "next/link";
import type { PublicRestaurant } from "@/lib/marketplace";
import { Stars } from "./Stars";
import { formatDistance } from "@/lib/geo";

/**
 * PHASE 6 discovery card.
 *
 *  ┌─────────────────────────────┐
 *  │       Restaurant Image      │
 *  ├─────────────────────────────┤
 *  │ Spice Garden                │
 *  │ ★ 4.6 • 328 reviews         │
 *  │ Indian • Chinese            │
 *  │ ₹₹                          │
 *  │        ORDER ONLINE         │
 *  └─────────────────────────────┘
 */
export function RestaurantCard({ r }: { r: PublicRestaurant }) {
  const orderable = r.isOpen && r.accepts.onlineOrders;

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <Link href={`/restaurants/${r.slug}`} className="block">
        <div className="relative h-40 overflow-hidden bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={r.imageUrl}
            alt={r.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />

          {r.featured && r.isOpen && (
            <span className="absolute left-3 top-3 rounded-full bg-orange-500 px-2.5 py-1 text-xs font-semibold text-white shadow">
              Featured
            </span>
          )}

          {/* Open / closed */}
          <span
            className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold shadow ${
              r.isOpen ? "bg-emerald-500 text-white" : "bg-slate-800 text-white"
            }`}
          >
            {r.isOpen ? "Open" : "Closed"}
          </span>

          {!r.isOpen && <div className="absolute inset-0 bg-white/45" />}
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <Link href={`/restaurants/${r.slug}`}>
          <h3 className="font-semibold leading-tight text-slate-900 hover:text-orange-600">
            {r.name}
          </h3>
        </Link>

        {/* ★ 4.6 • 328 reviews */}
        <div className="mt-1.5 flex items-center gap-1.5 text-sm">
          <Stars rating={r.rating} />
          {r.reviewCount > 0 ? (
            <span className="text-slate-600">
              <span className="font-semibold text-slate-800">
                {r.rating.toFixed(1)}
              </span>
              <span className="text-slate-400"> • </span>
              {r.reviewCount} {r.reviewCount === 1 ? "review" : "reviews"}
            </span>
          ) : (
            <span className="text-slate-400">No reviews yet</span>
          )}
        </div>

        {/* Indian • Chinese */}
        <p className="mt-1 text-sm text-slate-500">{r.cuisines.join(" • ")}</p>

        {/* ₹₹ + distance + veg */}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm font-medium text-slate-500">
          <span>{r.priceRange}</span>
          {r.distanceKm != null && (
            <span>· {formatDistance(r.distanceKm)}</span>
          )}
          {r.vegetarian && <span className="text-emerald-600">· Veg</span>}
          {r.deliversToYou === false && (
            <span className="text-amber-600">· Outside delivery</span>
          )}
        </p>

        {r.offers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {r.offers.slice(0, 2).map((o) => (
              <span
                key={o.code}
                className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600"
              >
                {o.title}
              </span>
            ))}
          </div>
        )}

        {/* ORDER ONLINE points to our stable redirect layer. */}
        <div className="mt-4">
          {orderable && r.menuUrl ? (
            <Link
              href={`/restaurants/${r.slug}/menu`}
              className="block w-full rounded-xl bg-orange-500 py-2.5 text-center text-sm font-bold tracking-wide text-white transition hover:bg-orange-600"
            >
              ORDER ONLINE
            </Link>
          ) : orderable ? (
            <span className="block w-full cursor-not-allowed rounded-xl bg-slate-100 py-2.5 text-center text-sm font-bold tracking-wide text-slate-400">
              MENU LINK NOT SET
            </span>
          ) : (
            <span className="block w-full cursor-not-allowed rounded-xl bg-slate-100 py-2.5 text-center text-sm font-bold tracking-wide text-slate-400">
              {!r.isOpen ? "CLOSED" : "ORDERING UNAVAILABLE"}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function RestaurantCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="h-40 animate-pulse bg-slate-200" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-10 animate-pulse rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}
