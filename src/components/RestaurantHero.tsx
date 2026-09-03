import Link from "next/link";
import type { PublicRestaurant } from "@/lib/marketplace";
import { currency } from "@/lib/format";
import { Stars } from "./Stars";
import { SaveRestaurantButton } from "./SaveRestaurantButton";

/**
 * PHASE 7 — Restaurant Profile as digital storefront.
 *
 * Matches spec:
 *   Hero image
 *   Spice Garden
 *   ★★★★★ 4.6
 *   328 reviews
 *   Indian • Chinese
 *   ₹₹
 *   OPEN
 *   [ ORDER ONLINE ]
 *   About / Reviews / Photos
 */
export function RestaurantHero({
  r,
  active,
}: {
  r: PublicRestaurant;
  active: "overview";
}) {
  return (
    <div>
      {/* Hero image */}
      <div className="relative h-64 overflow-hidden bg-slate-200 sm:h-80 sm:rounded-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={r.imageUrl}
          alt={r.name}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent sm:hidden" />

        <Link
          href="/restaurants"
          className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-800 shadow backdrop-blur transition hover:bg-white"
          aria-label="Back to restaurants"
        >
          ←
        </Link>

        <div className="absolute right-4 top-4">
          <SaveRestaurantButton slug={r.slug} />
        </div>
      </div>

      {/* Digital storefront details — below hero, per spec */}
      <div className="px-4 pt-5 sm:px-0">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {r.name}
          </h1>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold tracking-wide shadow-sm ${
              r.isOpen ? "bg-emerald-500 text-white" : "bg-slate-800 text-white"
            }`}
          >
            {r.isOpen ? "OPEN" : "CLOSED"}
          </span>
        </div>

        {/* ★★★★★ 4.6 */}
        <div className="mt-2 flex items-center gap-2">
          <Stars rating={r.rating} size="md" />
          <span className="text-sm font-semibold text-slate-800">
            {r.rating > 0 ? r.rating.toFixed(1) : "New"}
          </span>
        </div>

        {/* 328 reviews */}
        <p className="mt-1 text-sm text-slate-500">
          {r.reviewCount > 0
            ? `${r.reviewCount} ${r.reviewCount === 1 ? "review" : "reviews"}`
            : "No reviews yet"}
        </p>

        {/* Indian • Chinese */}
        <p className="mt-2 text-sm text-slate-600">
          {r.cuisines.join(" • ")}
        </p>

        {/* ₹₹ / $$ + fulfillment */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">{r.priceRange}</span>
          {r.accepts.delivery && (
            <span className="text-slate-400">
              • {r.deliveryFee === 0 ? "Free delivery" : `${currency(r.deliveryFee)} delivery`} • {r.etaMinutes} min
            </span>
          )}
          {r.accepts.pickup && (
            <span className="text-slate-400">• Pickup {r.pickupEtaMinutes} min</span>
          )}
        </div>

        {/* ORDER ONLINE points to our stable marketplace redirect URL. */}
        <div className="mt-5">
          {r.isOpen && r.accepts.onlineOrders && r.menuUrl ? (
            <Link
              href={`/restaurants/${r.slug}/menu`}
              className="block w-full rounded-xl bg-orange-500 py-3.5 text-center text-sm font-bold tracking-wide text-white shadow-sm transition hover:bg-orange-600"
            >
              ORDER ONLINE
            </Link>
          ) : r.isOpen && r.accepts.onlineOrders ? (
            <span className="block w-full rounded-xl bg-slate-100 py-3.5 text-center text-sm font-bold tracking-wide text-slate-400">
              MENU LINK NOT SET
            </span>
          ) : (
            <span className="block w-full rounded-xl bg-slate-100 py-3.5 text-center text-sm font-bold tracking-wide text-slate-400">
              {!r.isOpen ? "CLOSED" : "ORDERING UNAVAILABLE"}
            </span>
          )}
        </div>

        {/* Tabs: About / Reviews / Photos — marketplace is discovery-only. */}
        <div className="mt-6 flex gap-1 border-b border-slate-200">
          <Tab href={`/restaurants/${r.slug}`} active={active === "overview"}>
            About
          </Tab>
          <Tab href={`/restaurants/${r.slug}#reviews`} active={false}>
            Reviews
          </Tab>
          <Tab href={`/restaurants/${r.slug}#photos`} active={false}>
            Photos
          </Tab>
        </div>
      </div>
    </div>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? "border-orange-500 text-orange-600"
          : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
    </Link>
  );
}
