"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicRestaurant } from "@/lib/marketplace";
import { RestaurantCard } from "../RestaurantCard";
import { HomeRecentOrders } from "./HomeRecentOrders";
import { ArrowRightIcon, SearchIcon } from "@/components/ui/icons";

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
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-ember-600/25 via-ink-900 to-ink-950" />
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/5" />
        <div className="absolute -right-8 -top-8 h-48 w-48 rounded-full border border-white/5" />

        <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-14">
          <div className="max-w-2xl animate-fade-in-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/80 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-ember-400" />
              Order from local kitchens, straight from their counter
            </span>

            <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
              <span className="text-gradient">Dinner plans,</span>
              <br />
              <span className="text-gradient">sorted.</span>
            </h1>

            <p className="mt-5 max-w-lg text-base leading-relaxed text-white/60 sm:text-lg">
              Discover the city&apos;s most loved kitchens, order from their own
              counter, and track every step.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                router.push(
                  q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/restaurants",
                );
              }}
              className="mt-7 flex max-w-lg items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur-md"
            >
              <span className="pl-3 text-white/40">
                <SearchIcon className="text-xl" />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search restaurants, cuisines, dishes…"
                aria-label="Search restaurants or food"
                className="h-11 flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
              />
              <button
                type="submit"
                aria-label="Search"
                className="grid h-11 w-11 place-items-center rounded-xl bg-ember-500 text-ink-950 transition-colors hover:bg-ember-400"
              >
                <ArrowRightIcon className="text-lg" />
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Recent orders / live tracking — Zomato style; hidden when no history */}
      <HomeRecentOrders />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Categories */}
        <section className="mt-10">
          <SectionHead title="Categories" href="/restaurants" />
          <div className="no-scrollbar -mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {categories.map((c) => (
              <Link
                key={c.cuisine}
                href={`/restaurants?cuisine=${encodeURIComponent(c.cuisine)}`}
                className="card-lift group flex w-24 shrink-0 flex-col items-center gap-2 rounded-3xl border border-white/8 bg-ink-850 px-3 py-4 text-center transition-all hover:border-ember-500/40"
              >
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-2xl">
                  {CUISINE_EMOJI[c.cuisine] ?? "🍽️"}
                </span>
                <span className="text-xs font-semibold leading-tight text-white">
                  {c.cuisine}
                </span>
                <span className="text-[11px] text-white/40">{c.restaurantCount}</span>
              </Link>
            ))}
            {categories.length === 0 && (
              <p className="text-sm text-white/40">No categories yet.</p>
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
              <p className="mt-3 rounded-3xl border border-dashed border-white/10 bg-ink-850 p-6 text-center text-sm text-white/40">
                Nothing here yet.
              </p>
            ) : (
              <div className="no-scrollbar -mx-4 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
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
            className="card-lift block rounded-3xl border border-white/8 bg-ink-850 py-4 text-center text-sm font-semibold text-ember-400 transition-all hover:border-ember-500/40"
          >
            Browse all restaurants →
          </Link>

          <div className="card-lift mt-4 rounded-3xl border border-white/8 bg-ink-850 p-6 text-center sm:p-8">
            <h3 className="text-lg font-bold tracking-tight text-white">
              Run a restaurant?
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-white/45">
              Get discovered by local customers and start receiving online
              orders. It takes a couple of minutes.
            </p>
            <Link
              href="/list-your-restaurant"
              className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-ember-500 px-6 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
            >
              List your restaurant <ArrowRightIcon />
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
        <h2 className="text-2xl font-semibold tracking-tight text-white">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-white/45">{subtitle}</p>}
      </div>
      <Link
        href={href}
        className="shrink-0 text-sm font-semibold text-ember-400 transition-colors hover:text-ember-300"
      >
        See all
      </Link>
    </div>
  );
}