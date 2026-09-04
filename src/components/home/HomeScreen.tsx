"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicRestaurant } from "@/lib/marketplace";
import { RestaurantCard } from "../RestaurantCard";

export type Rail = {
  key: string;
  title: string;
  subtitle: string;
  items: PublicRestaurant[];
};

export type Category = {
  cuisine: string;
  restaurantCount: number;
  priceRanges: string[];
};

const CUISINE_EMOJI: Record<string, string> = {
  American: "🍔",
  Chinese: "🥡",
  Dessert: "🍰",
  Indian: "🍛",
  Italian: "🍕",
  Japanese: "🍣",
  Korean: "🍜",
  Lebanese: "🥙",
  Mediterranean: "🫒",
  Mexican: "🌮",
  Thai: "🍤",
  Vietnamese: "🍲",
};

export function HomeScreen({
  categories,
  rails,
}: {
  categories: Category[];
  rails: Rail[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <main>
      {/* Hero + search */}
      <section className="bg-gradient-to-br from-orange-500 via-orange-500 to-rose-500 px-4 pb-8 pt-6 text-white sm:px-6 sm:pb-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            TABL<span className="text-orange-100">Z</span>
          </h1>
          <p className="mt-1 text-orange-50">
            Order from local kitchens, straight from their counter.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              router.push(
                q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/restaurants",
              );
            }}
            className="relative mt-5"
          >
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
              🔍
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search restaurants or food"
              aria-label="Search restaurants or food"
              className="w-full rounded-2xl border-0 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-900 shadow-lg outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-white/60"
            />
          </form>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Categories */}
        <section className="mt-8">
          <SectionHead title="Categories" href="/restaurants" />
          <div className="-mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((c) => (
              <Link
                key={c.cuisine}
                href={`/restaurants?cuisine=${encodeURIComponent(c.cuisine)}`}
                className="flex w-24 shrink-0 flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-orange-50 text-2xl">
                  {CUISINE_EMOJI[c.cuisine] ?? "🍽️"}
                </span>
                <span className="text-xs font-semibold leading-tight text-slate-700">
                  {c.cuisine}
                </span>
                <span className="text-[11px] text-slate-400">
                  {c.restaurantCount}
                </span>
              </Link>
            ))}
            {categories.length === 0 && (
              <p className="text-sm text-slate-500">No categories yet.</p>
            )}
          </div>
        </section>

        {/* Rails */}
        {rails.map((rail) => (
          <section key={rail.key} className="mt-10">
            <SectionHead
              title={rail.title}
              subtitle={rail.subtitle}
              href={`/restaurants?sort=${rail.key}`}
            />
            {rail.items.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                Nothing here yet.
              </p>
            ) : (
              <div className="-mx-4 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {rail.items.map((r) => (
                  <div
                    key={r.id}
                    className="w-[260px] shrink-0 snap-start sm:w-[280px]"
                  >
                    <RestaurantCard r={r} />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}

        <div className="mt-10 pb-4">
          <Link
            href="/restaurants"
            className="block rounded-2xl border border-slate-200 bg-white py-3.5 text-center text-sm font-semibold text-orange-600 shadow-sm transition hover:border-orange-300"
          >
            Browse all restaurants →
          </Link>

          <div className="mt-4 rounded-2xl bg-slate-100 p-6 text-center sm:p-8">
            <h3 className="text-lg font-bold tracking-tight text-slate-900">
              Run a restaurant?
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
              Get discovered by local customers and start receiving online
              orders. It takes a couple of minutes.
            </p>
            <Link
              href="/list-your-restaurant"
              className="mt-4 inline-block rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600"
            >
              List your restaurant →
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function SectionHead({
  title,
  subtitle,
  href,
}: {
  title: string;
  subtitle?: string;
  href: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      <Link
        href={href}
        className="shrink-0 text-sm font-semibold text-orange-600 hover:underline"
      >
        See all
      </Link>
    </div>
  );
}
