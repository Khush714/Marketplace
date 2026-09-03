"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PublicRestaurant, SortKey } from "@/lib/marketplace";
import { RestaurantCard, RestaurantCardSkeleton } from "./RestaurantCard";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recommended", label: "Recommended" },
  { key: "nearby", label: "Nearby" },
  { key: "rating", label: "Top rated" },
  { key: "popular", label: "Most reviewed" },
  { key: "name", label: "A–Z" },
];

export function RestaurantBrowser({
  initialItems,
  initialTotal,
  cuisines,
  initialQuery,
  initialCuisine,
  initialSort,
}: {
  initialItems: PublicRestaurant[];
  initialTotal: number;
  cuisines: string[];
  initialQuery: string;
  initialCuisine: string;
  initialSort: SortKey;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(initialQuery);
  const [cuisine, setCuisine] = useState(initialCuisine);
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [openOnly, setOpenOnly] = useState(false);
  const [pickup, setPickup] = useState(false);
  const [delivery, setDelivery] = useState(false);
  const [vegetarian, setVegetarian] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [priceRange, setPriceRange] = useState("all");
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("tablz_loc");
      if (raw) setLoc(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("search", q.trim());
      if (cuisine !== "all") params.set("cuisine", cuisine);
      if (sort !== "recommended") params.set("sort", sort);
      if (openOnly) params.set("open", "true");
      if (pickup) params.set("pickup", "true");
      if (delivery) params.set("delivery", "true");
      if (vegetarian) params.set("vegetarian", "true");
      if (minRating) params.set("minRating", String(minRating));
      if (priceRange !== "all") params.set("priceRange", priceRange);
      if (loc) {
        params.set("lat", String(loc.lat));
        params.set("lng", String(loc.lng));
      }
      params.set("limit", "60");

      const res = await fetch(`/api/marketplace/restaurants?${params}`);
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);

      // Keep the URL shareable/bookmarkable.
      const url = new URLSearchParams();
      if (q.trim()) url.set("q", q.trim());
      if (cuisine !== "all") url.set("cuisine", cuisine);
      if (sort !== "recommended") url.set("sort", sort);
      const qs = url.toString();
      window.history.replaceState(null, "", qs ? `/restaurants?${qs}` : "/restaurants");
    } catch {
      /* keep last good state */
    } finally {
      setLoading(false);
    }
  }, [q, cuisine, sort, openOnly, pickup, delivery, vegetarian, minRating, priceRange, loc]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // React to header search submissions (?q=…) while already on this page.
  useEffect(() => {
    const urlQ = searchParams.get("q") ?? "";
    setQ((prev) => (urlQ && urlQ !== prev ? urlQ : prev));
  }, [searchParams]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
      <header className="pt-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Restaurants
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {loading ? "Searching…" : `${total} ${total === 1 ? "place" : "places"} to order from`}
        </p>
      </header>

      {/* Search */}
      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
          🔍
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search restaurants or food"
          aria-label="Search restaurants or food"
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
        />
      </div>

      {/* Cuisine chips */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip label="All" active={cuisine === "all"} onClick={() => setCuisine("all")} />
        {cuisines.map((c) => (
          <Chip
            key={c}
            label={c}
            active={cuisine === c}
            onClick={() => setCuisine(cuisine === c ? "all" : c)}
          />
        ))}
      </div>

      {/* Sort + filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                sort === s.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOpenOnly((v) => !v)}
          className={`ml-auto shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            openOnly
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          {openOnly ? "✓ " : ""}Open now
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {["all", "$", "$$", "$$$"].map((p) => (
          <Chip
            key={p}
            label={p === "all" ? "Any price" : p}
            active={priceRange === p}
            onClick={() => setPriceRange(p)}
          />
        ))}
        <Chip
          label={minRating ? `★ ${minRating}+` : "Rating"}
          active={minRating > 0}
          onClick={() => setMinRating((n) => (n === 4 ? 0 : 4))}
        />
        <Chip label="Vegetarian" active={vegetarian} onClick={() => setVegetarian((v) => !v)} />
        <Chip label="Pickup" active={pickup} onClick={() => setPickup((v) => !v)} />
        <Chip label="Delivery" active={delivery} onClick={() => setDelivery((v) => !v)} />
        <button
          onClick={() => {
            if (!navigator.geolocation) {
              setLocMsg("Geolocation not supported");
              return;
            }
            setLocMsg("Locating…");
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setLoc(next);
                localStorage.setItem("tablz_loc", JSON.stringify(next));
                setLocMsg("Nearby on");
                setSort("nearby");
              },
              () => {
                // Demo fallback: downtown cluster used in seed data.
                const next = { lat: 40.735, lng: -73.99 };
                setLoc(next);
                localStorage.setItem("tablz_loc", JSON.stringify(next));
                setLocMsg("Using downtown demo location");
                setSort("nearby");
              },
              { timeout: 4000 },
            );
          }}
          className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
            loc
              ? "border-sky-500 bg-sky-50 text-sky-700"
              : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          {loc ? "📍 Nearby" : "Use my location"}
        </button>
      </div>
      {locMsg && <p className="mt-1 text-xs text-slate-400">{locMsg}</p>}

      {/* Grid */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {loading && items.length === 0
          ? Array.from({ length: 6 }).map((_, i) => <RestaurantCardSkeleton key={i} />)
          : items.map((r) => <RestaurantCard key={r.id} r={r} />)}
      </div>

      {!loading && items.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-600">No restaurants match your search.</p>
          <button
            onClick={() => {
              setQ("");
              setCuisine("all");
              setOpenOnly(false);
              setPickup(false);
              setDelivery(false);
              setVegetarian(false);
              setMinRating(0);
              setPriceRange("all");
              setSort("recommended");
            }}
            className="mt-3 rounded-xl bg-orange-500 px-5 py-2 text-sm font-semibold text-white"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Roadmap transparency */}
      <p className="mt-8 text-center text-xs text-slate-400">
        Filters: cuisine · rating · price · vegetarian · open now · pickup ·
        delivery. Nearby uses your location against each restaurant&apos;s
        delivery radius.
      </p>
      <button
        onClick={() => router.refresh()}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />
    </main>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "border-orange-500 bg-orange-500 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );
}
