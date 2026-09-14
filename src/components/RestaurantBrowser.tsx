"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PublicRestaurant, SortKey } from "@/lib/marketplace";
import { RestaurantCard, RestaurantCardSkeleton } from "./RestaurantCard";
import { MapPinIcon, SearchIcon, SlidersIcon, XIcon } from "./ui/icons";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recommended", label: "Recommended" },
  { key: "nearby", label: "Nearby" },
  { key: "rating", label: "Top rated" },
  { key: "popular", label: "Most reviewed" },
  { key: "name", label: "A–Z" },
];

const chipBase =
  "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ";
const chipIdle = "border-white/10 bg-white/5 text-white/60 hover:bg-white/10";
const chipActive = "border-ember-500/50 bg-ember-500/15 text-ember-400";

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
    <main className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Restaurants
        </h1>
        <p className="mt-1 text-sm text-white/45">
          {loading ? "Searching…" : `${total} ${total === 1 ? "place" : "places"} to order from`}
        </p>
      </header>

      {/* Search */}
      <div className="relative mt-4">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
          <SearchIcon className="text-lg" />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search restaurants or food"
          aria-label="Search restaurants or food"
          className="h-12 w-full rounded-2xl border border-white/10 bg-white/5 pl-11 pr-4 text-sm text-white placeholder-white/40 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
        />
      </div>

      {/* Cuisine chips */}
      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
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
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                sort === s.key
                  ? "border-white/15 bg-white text-ink-950"
                  : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOpenOnly((v) => !v)}
          className={`ml-auto shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
            openOnly
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-400"
              : chipIdle
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
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            loc
              ? "border-ember-500/50 bg-ember-500/15 text-ember-400"
              : chipIdle
          }`}
        >
          <MapPinIcon className="text-base" />
          {loc ? "Nearby" : "Use my location"}
        </button>
      </div>
      {locMsg && <p className="mt-1 text-xs text-white/40">{locMsg}</p>}

      {/* Grid */}
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {loading && items.length === 0
          ? Array.from({ length: 6 }).map((_, i) => <RestaurantCardSkeleton key={i} />)
          : items.map((r) => <RestaurantCard key={r.id} r={r} />)}
      </div>

      {!loading && items.length === 0 && (
        <div className="mt-10 rounded-3xl border border-dashed border-white/10 bg-ink-850 p-10 text-center">
          <div className="text-4xl">🔍</div>
          <p className="mt-4 text-white/70">No restaurants match your search.</p>
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
            className="mt-2 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-ember-500 px-6 text-sm font-semibold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98]"
          >
            <XIcon className="text-base" /> Clear filters
          </button>
        </div>
      )}

      {/* Roadmap transparency */}
      <p className="mt-8 text-center text-xs text-white/30">
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
      className={`${chipBase} ${active ? chipActive : chipIdle}`}
    >
      {label}
    </button>
  );
}