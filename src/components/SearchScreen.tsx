"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { PublicRestaurant } from "@/lib/marketplace";
import { currency } from "@/lib/format";
import { RestaurantCard } from "./RestaurantCard";
import { ChevronRightIcon, SearchIcon, XIcon } from "./ui/icons";

type DishHit = {
  id: number;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  available: boolean;
  restaurant: { slug: string; name: string; menuUrl: string };
};

export function SearchScreen() {
  const router = useRouter();
  const sp = useSearchParams();
  const initial = sp.get("q") ?? "";
  const [q, setQ] = useState(initial);
  const [restaurants, setRestaurants] = useState<PublicRestaurant[]>([]);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [dishes, setDishes] = useState<DishHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRestaurants([]);
      setCuisines([]);
      setDishes([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/marketplace/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setRestaurants(data.restaurants ?? []);
        setCuisines(data.cuisines ?? []);
        setDishes(data.dishes ?? []);
        window.history.replaceState(null, "", `/search?q=${encodeURIComponent(term)}`);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">Search</h1>
      <p className="mt-1 text-sm text-white/45">
        Restaurant → cuisine → food item
      </p>

      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
          <SearchIcon className="text-lg" />
        </span>
        <input
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search restaurants, cuisines or dishes"
          className="h-12 w-full rounded-2xl border border-white/10 bg-white/5 pl-11 pr-10 text-sm text-white placeholder-white/40 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white"
          >
            <XIcon className="text-lg" />
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-white/40">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-ember-500 border-t-transparent" />
          Searching…
        </div>
      )}

      {cuisines.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40">
            Cuisine
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {cuisines.map((c) => (
              <Link
                key={c}
                href={`/restaurants?cuisine=${encodeURIComponent(c)}`}
                className="rounded-full border border-ember-500/30 bg-ember-500/10 px-4 py-1.5 text-sm font-semibold text-ember-400 transition-colors hover:bg-ember-500/20"
              >
                {c}
              </Link>
            ))}
          </div>
        </section>
      )}

      {restaurants.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40">
            Restaurant
          </h2>
          <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {restaurants.map((r) => (
              <RestaurantCard key={r.id} r={r} />
            ))}
          </div>
        </section>
      )}

      {dishes.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/40">
            Food item
          </h2>
          <ul className="mt-3 divide-y divide-white/5 overflow-hidden rounded-3xl border border-white/8 bg-ink-850">
            {dishes.map((d) => {
              const inner = (
                <>
                  <div>
                    <p className="font-medium text-white">{d.name}</p>
                    <p className="text-xs text-white/45">
                      {d.restaurant.name}
                      {d.restaurant.menuUrl ? " · stable menu link" : ""}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-white/80">
                    {currency(d.price)}
                  </span>
                </>
              );
              return (
                <li key={d.id}>
                  <Link
                    href={
                      d.restaurant.menuUrl
                        ? `/restaurants/${d.restaurant.slug}/menu`
                        : `/restaurants/${d.restaurant.slug}`
                    }
                    className="group flex items-center justify-between gap-3 p-4 transition-colors hover:bg-white/5"
                  >
                    {inner}
                    <ChevronRightIcon className="text-white/25 transition-colors group-hover:text-white/50" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!loading && q.trim() && restaurants.length === 0 && dishes.length === 0 && (
        <div className="mt-10 grid place-items-center rounded-3xl border border-dashed border-white/10 py-16 text-center">
          <div className="text-4xl">🔍</div>
          <p className="mt-4 text-lg font-semibold text-white">No matches found</p>
          <p className="mt-1 text-sm text-white/45">Nothing matches “{q}”.</p>
        </div>
      )}

      {!q.trim() && (
        <button
          onClick={() => router.push("/restaurants")}
          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-4 py-2.5 text-sm font-semibold text-ember-400 transition-colors hover:bg-white/10 hover:text-ember-300"
        >
          Browse all restaurants <ChevronRightIcon />
        </button>
      )}
    </main>
  );
}