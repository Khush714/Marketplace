"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { PublicRestaurant } from "@/lib/marketplace";
import { currency } from "@/lib/format";
import { RestaurantCard } from "./RestaurantCard";

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
    <main className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <h1 className="pt-6 text-2xl font-bold tracking-tight">Search</h1>
      <p className="mt-1 text-sm text-slate-500">
        Restaurant → cuisine → food item
      </p>
      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          🔍
        </span>
        <input
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search restaurants, cuisines or dishes"
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        />
      </div>

      {loading && <p className="mt-4 text-sm text-slate-400">Searching…</p>}

      {cuisines.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Cuisine
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {cuisines.map((c) => (
              <Link
                key={c}
                href={`/restaurants?cuisine=${encodeURIComponent(c)}`}
                className="rounded-full bg-orange-50 px-4 py-1.5 text-sm font-semibold text-orange-700"
              >
                {c}
              </Link>
            ))}
          </div>
        </section>
      )}

      {restaurants.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
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
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Food item
          </h2>
          <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {dishes.map((d) => {
              const inner = (
                <>
                  <div>
                    <p className="font-medium text-slate-900">{d.name}</p>
                    <p className="text-xs text-slate-500">
                      {d.restaurant.name}
                      {d.restaurant.menuUrl ? " · stable menu link" : ""}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
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
                    className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"
                  >
                    {inner}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!loading && q.trim() && restaurants.length === 0 && dishes.length === 0 && (
        <p className="mt-10 text-center text-slate-500">No matches for “{q}”.</p>
      )}

      {!q.trim() && (
        <button
          onClick={() => router.push("/restaurants")}
          className="mt-8 text-sm font-semibold text-orange-600"
        >
          Browse all restaurants →
        </button>
      )}
    </main>
  );
}
