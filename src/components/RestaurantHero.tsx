import Link from "next/link";
import type { PublicRestaurant } from "@/lib/marketplace";
import { currency } from "@/lib/format";
import { resolveMenuLink } from "@/lib/menu-url";
import { marketplaceOrderingEnabled } from "@/lib/feature-flags";
import { Stars } from "./Stars";
import { SaveRestaurantButton } from "./SaveRestaurantButton";
import { ArrowLeftIcon } from "./ui/icons";

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
      <div className="relative h-64 overflow-hidden bg-ink-900 sm:h-80 sm:rounded-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={r.imageUrl}
          alt={r.name}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/70 via-transparent to-transparent" />

        <Link
          href="/restaurants"
          className="card-lift absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-ink-950/60 text-white backdrop-blur-md transition-colors hover:bg-ink-950/80"
          aria-label="Back to restaurants"
        >
          <ArrowLeftIcon className="text-lg" />
        </Link>

        <div className="absolute right-4 top-4">
          <SaveRestaurantButton slug={r.slug} />
        </div>
      </div>

      {/* Digital storefront details — below hero, per spec */}
      <div className="px-4 pt-5 sm:px-0">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {r.name}
          </h1>
          <span
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${
              r.isOpen
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-white/50"
            }`}
          >
            {r.isOpen ? "OPEN" : "CLOSED"}
          </span>
        </div>

        {/* ★★★★★ 4.6 */}
        <div className="mt-2 flex items-center gap-2">
          <Stars rating={r.rating} size="md" />
          <span className="text-sm font-semibold text-white/80">
            {r.rating > 0 ? r.rating.toFixed(1) : "New"}
          </span>
        </div>

        {/* 328 reviews */}
        <p className="mt-1 text-sm text-white/45">
          {r.reviewCount > 0
            ? `${r.reviewCount} ${r.reviewCount === 1 ? "review" : "reviews"}`
            : "No reviews yet"}
        </p>

        {/* Indian • Chinese */}
        <p className="mt-2 text-sm text-white/55">{r.cuisines.join(" • ")}</p>

        {/* ₹₹ / $$ + fulfillment */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-white/80">{r.priceRange}</span>
          {r.accepts.delivery && (
            <span className="text-white/40">
              • {r.deliveryFee === 0 ? "Free delivery" : `${currency(r.deliveryFee)} delivery`} • {r.etaMinutes} min
            </span>
          )}
          {r.accepts.pickup && (
            <span className="text-white/40">• Pickup {r.pickupEtaMinutes} min</span>
          )}
        </div>

        {/* ORDER ONLINE — in-marketplace checkout when ordering is reactivated,
            otherwise the restaurant's hosted menu URL. */}
        <div className="mt-5">
          {r.isOpen &&
          r.accepts.onlineOrders &&
          (marketplaceOrderingEnabled || r.menuUrl) ? (
            <a
              href={resolveMenuLink(r.menuUrl, r.slug, {
                preferInternal: marketplaceOrderingEnabled,
              })}
              className="block w-full rounded-2xl bg-ember-500 py-3.5 text-center text-sm font-bold tracking-wide text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
            >
              ORDER ONLINE
            </a>
          ) : r.isOpen && r.accepts.onlineOrders ? (
            <span className="block w-full rounded-2xl border border-white/8 bg-white/5 py-3.5 text-center text-sm font-bold tracking-wide text-white/40">
              MENU LINK NOT SET
            </span>
          ) : (
            <span className="block w-full rounded-2xl border border-white/8 bg-white/5 py-3.5 text-center text-sm font-bold tracking-wide text-white/40">
              {!r.isOpen ? "CLOSED" : "ORDERING UNAVAILABLE"}
            </span>
          )}
        </div>

        {/* Tabs: About / Reviews / Photos — marketplace is discovery-only. */}
        <div className="mt-6 flex gap-1 border-b border-white/8">
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
          ? "border-ember-400 text-ember-400"
          : "border-transparent text-white/45 hover:text-white/80"
      }`}
    >
      {children}
    </Link>
  );
}