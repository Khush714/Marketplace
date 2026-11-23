import type { Metadata } from "next";
import { UtensilsCrossed } from "lucide-react";
import { EmptyState } from "@/components/atoms";
import { BrowseFilters } from "@/components/browse-filters";
import { RestaurantCard } from "@/components/restaurant-card";
import { browseRestaurants, type BrowseFilters as Filters } from "@/db/queries";
import { parseBrowseParams, type BrowseParams } from "@/lib/browse-filter-params";
import { localityByKey, withLoc } from "@/lib/domain";

export const dynamic = "force-dynamic";

/**
 * Generated because the page is filter-scoped. A `?q=`/`?cuisine=` variant
 * renders a different grid, but those are the same listing surface and must not
 * compete with each other in search — hence the canonical pinned to the
 * unfiltered path while the description reports what is actually on screen.
 */
export async function generateMetadata(props: {
  searchParams: Promise<BrowseParams>;
}): Promise<Metadata> {
  const sp = await props.searchParams;
  const parsed = parseBrowseParams(sp);
  const locality = localityByKey(parsed.loc);
  const cuisine = parsed.cuisine?.trim();
  const q = parsed.q?.trim();

  const subject = q ? `“${q}”` : cuisine ? `${cuisine} restaurants` : "restaurants";
  const title = q ? `Results for “${q}”` : cuisine ? `Best ${cuisine} nearby` : "Explore restaurants";

  return {
    title,
    description: `Find ${subject} delivering to ${locality.name}, ${locality.city}. Filter by cuisine, cost, rating, offers, delivery time and what is open now, then order in minutes.`,
    alternates: { canonical: "/restaurants" },
  };
}

export default async function RestaurantsPage(props: { searchParams: Promise<BrowseParams> }) {
  const sp = await props.searchParams;
  const parsed = parseBrowseParams(sp);
  const locality = localityByKey(parsed.loc);
  const filters: Filters = {
    q: parsed.q?.trim() || undefined,
    cuisine: parsed.cuisine || undefined,
    sort: parsed.sort,
    offers: parsed.offers,
    minRating: parsed.minRating,
    veg: parsed.veg,
    openNow: parsed.openNow,
    delivery: parsed.delivery,
    price: parsed.price,
    maxTime: parsed.maxTime,
    locality: locality.name,
  };
  const restaurants = await browseRestaurants(filters);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 md:px-6 md:pt-7">
      <header className="mb-3 md:mb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">Discover</p>
        <h1 className="mt-1 font-display text-[26px] font-bold tracking-tight text-cream-50 md:mt-1.5 md:text-4xl">
          {filters.q ? (
            <>
              Results for <span className="text-gradient">“{filters.q}”</span>
            </>
          ) : filters.cuisine ? (
            <>
              Best <span className="text-gradient">{filters.cuisine}</span> nearby
            </>
          ) : (
            "All kitchens"
          )}
        </h1>
        <p className="mt-1 text-xs text-cream-500 md:mt-1.5 md:text-sm">
          {restaurants.length} {restaurants.length === 1 ? "place" : "places"} delivering to {locality.name}
        </p>
      </header>

      <BrowseFilters sp={sp} />

      {restaurants.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<UtensilsCrossed className="size-6" />}
            title="Nothing matches those filters"
            sub="Try widening the net — clear a filter or two, or search for a different craving."
            action={
              <a
                href={withLoc("/restaurants", locality.key)}
                className="press mt-2 rounded-full bg-gradient-to-b from-ember-400 to-chili-600 px-5 py-2.5 text-sm font-bold text-white shadow-glow"
              >
                Clear all filters
              </a>
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-3 sm:mt-7 sm:grid-cols-2 sm:gap-y-8 lg:grid-cols-3 lg:gap-x-4 xl:grid-cols-4">
          {restaurants.map((r, i) => (
            <RestaurantCard key={r.slug} restaurant={r} priority={i < 4} variant="row" />
          ))}
        </div>
      )}
    </div>
  );
}
