import type { Metadata } from "next";
import { UtensilsCrossed } from "lucide-react";
import { EmptyState } from "@/components/atoms";
import { BrowseFilters } from "@/components/browse-filters";
import { RestaurantCard } from "@/components/restaurant-card";
import { browseRestaurants, type BrowseFilters as Filters } from "@/db/queries";
import { localityByKey, withLoc } from "@/lib/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "crave. — Explore restaurants" };

interface SearchParams {
  q?: string;
  cuisine?: string;
  sort?: string;
  offers?: string;
  minRating?: string;
  veg?: string;
  loc?: string;
}

export default async function RestaurantsPage(props: { searchParams: Promise<SearchParams> }) {
  const sp = await props.searchParams;
  const locality = localityByKey(sp.loc);
  const filters: Filters = {
    q: sp.q?.trim() || undefined,
    cuisine: sp.cuisine || undefined,
    sort: (sp.sort as Filters["sort"]) || undefined,
    offers: sp.offers === "1",
    minRating: sp.minRating === "1",
    veg: sp.veg === "1",
    locality: locality.name,
  };
  const restaurants = await browseRestaurants(filters);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-6 md:px-6 md:pt-9">
      <header className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ember-400">Discover</p>
        <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-cream-50 md:text-4xl">
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
        <p className="mt-1.5 text-sm text-cream-500">
          {restaurants.length} {restaurants.length === 1 ? "place" : "places"} delivering to {locality.name}
        </p>
      </header>

      <BrowseFilters sp={{ q: sp.q, cuisine: sp.cuisine, sort: sp.sort, offers: sp.offers, minRating: sp.minRating, veg: sp.veg, loc: sp.loc }} />

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
        <div className="mt-7 grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {restaurants.map((r, i) => (
            <RestaurantCard key={r.slug} restaurant={r} priority={i < 4} />
          ))}
        </div>
      )}
    </div>
  );
}
