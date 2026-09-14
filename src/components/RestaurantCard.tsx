"use client";

import Link from "next/link";
import type { PublicRestaurant } from "@/lib/marketplace";
import { Stars } from "./Stars";
import { formatDistance } from "@/lib/geo";
import { resolveMenuLink } from "@/lib/menu-url";
import { ClockIcon, MapPinIcon } from "./ui/icons";

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
const GRADIENTS = [
  "from-orange-500/80 via-rose-500/70 to-ink-900",
  "from-emerald-500/70 via-teal-500/60 to-ink-900",
  "from-indigo-500/70 via-purple-500/60 to-ink-900",
  "from-amber-500/80 via-orange-600/70 to-ink-900",
  "from-sky-500/70 via-cyan-500/60 to-ink-900",
];

function pickGradient(name: string) {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return GRADIENTS[sum % GRADIENTS.length];
}

export function RestaurantCard({ r }: { r: PublicRestaurant }) {
  const orderable = r.isOpen && r.accepts.onlineOrders;
  const menuHref = resolveMenuLink(r.menuUrl, r.slug, {
    preferInternal: r.ordersInternal,
  });

  return (
    <article className="card-lift group flex flex-col overflow-hidden rounded-3xl border border-white/8 bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      <Link href={`/restaurants/${r.slug}`} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-ink-900">
          {r.imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.imageUrl}
                alt={r.name}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/50 to-transparent" />
            </>
          ) : (
            <div
              className={`absolute inset-0 bg-gradient-to-br ${pickGradient(r.name)}`}
            />
          )}

          {/* decorative rings */}
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full border border-white/10" />
          <div className="absolute -right-2 -top-2 h-24 w-24 rounded-full border border-white/10" />

          {r.featured && r.isOpen && (
            <span className="absolute left-3 top-3 rounded-full bg-ember-500 px-3 py-1 text-[11px] font-bold text-ink-950">
              Featured
            </span>
          )}

          {/* Open / closed */}
          <span
            className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-bold backdrop-blur-md ${
              r.isOpen
                ? "border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                : "border border-white/10 bg-ink-950/60 text-white/70"
            }`}
          >
            {r.isOpen ? "Open now" : "Closed"}
          </span>

          {!r.isOpen && <div className="absolute inset-0 bg-ink-950/40" />}
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <Link href={`/restaurants/${r.slug}`}>
          <h3 className="text-lg font-semibold leading-tight tracking-tight text-white transition-colors group-hover:text-ember-400">
            {r.name}
          </h3>
        </Link>

        {/* ★ 4.6 • 328 reviews */}
        <div className="mt-1.5 flex items-center gap-1.5 text-sm">
          <Stars rating={r.rating} />
          {r.reviewCount > 0 ? (
            <span className="text-white/50">
              <span className="font-semibold text-white/80">
                {r.rating.toFixed(1)}
              </span>
              <span className="text-white/30"> • </span>
              {r.reviewCount} {r.reviewCount === 1 ? "review" : "reviews"}
            </span>
          ) : (
            <span className="text-white/40">No reviews yet</span>
          )}
        </div>

        {/* Indian • Chinese */}
        <p className="mt-1 text-sm text-white/45">{r.cuisines.join(" • ")}</p>

        {/* ₹₹ + distance + veg */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
          <span className="inline-flex items-center gap-1.5">
            <MapPinIcon className="text-base text-ember-400" />
            {r.distanceKm != null ? formatDistance(r.distanceKm) : r.priceRange}
          </span>
          {r.distanceKm != null && <span>{r.priceRange}</span>}
          {r.vegetarian && (
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Veg
            </span>
          )}
          {r.deliversToYou === false && (
            <span className="inline-flex items-center gap-1.5 text-white/40">
              <ClockIcon className="text-base" /> Outside delivery
            </span>
          )}
        </div>

        {r.offers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {r.offers.slice(0, 2).map((o) => (
              <span
                key={o.code}
                className="rounded-full border border-ember-500/20 bg-ember-500/10 px-2.5 py-0.5 text-[11px] font-bold text-ember-400"
              >
                {o.title}
              </span>
            ))}
          </div>
        )}

        {/* ORDER ONLINE — in-marketplace checkout when ordering is reactivated,
            otherwise the restaurant's hosted menu URL (stable redirect layer). */}
        <div className="mt-4">
          {orderable && (r.ordersInternal || r.menuUrl) ? (
            <a
              href={menuHref}
              className="block w-full rounded-xl bg-ember-500 py-2.5 text-center text-sm font-bold tracking-wide text-ink-950 transition-colors hover:bg-ember-400"
            >
              ORDER ONLINE
            </a>
          ) : orderable ? (
            <span className="block w-full cursor-not-allowed rounded-xl border border-white/8 bg-white/5 py-2.5 text-center text-sm font-bold tracking-wide text-white/40">
              MENU LINK NOT SET
            </span>
          ) : (
            <span className="block w-full cursor-not-allowed rounded-xl border border-white/8 bg-white/5 py-2.5 text-center text-sm font-bold tracking-wide text-white/40">
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
    <div className="card-lift overflow-hidden rounded-3xl border border-white/8 bg-ink-850">
      <div className="aspect-[16/10] shimmer" />
      <div className="space-y-2 p-5">
        <div className="h-4 w-2/3 rounded shimmer" />
        <div className="h-3 w-1/2 rounded shimmer" />
        <div className="h-3 w-1/3 rounded shimmer" />
        <div className="mt-4 h-10 rounded-xl shimmer" />
      </div>
    </div>
  );
}