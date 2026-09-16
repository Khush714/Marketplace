"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Clock3,
  Flame,
  Leaf,
  Percent,
  Search,
  Star,
  TrendingUp,
  X,
} from "lucide-react";
import { cn, formatINR } from "@/lib/domain";
import { cssVars } from "@/components/motion-primitives";
import { useProfile } from "@/lib/profile";
import type { DishSearchResult, RestaurantDto, RestaurantSearchResult, SearchResult } from "@/lib/types";

/* ------------------------------ context ---------------------------------- */

interface SearchContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}

const TRENDING = ["Pizza", "Biryani", "Sushi", "Burgers", "Ramen", "Desserts", "Tacos", "Salad"];

export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Global "/" shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      {isOpen && <SearchOverlay onClose={close} />}
    </SearchContext.Provider>
  );
}

/* ------------------------------ overlay ---------------------------------- */

const BLUR =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP8//8/AzGAiShVDAwMAAA5/wH/AO3zbwAAAABJRU5ErkJggg==";

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [featured, setFeatured] = useState<RestaurantDto[]>([]);
  const { recentSearches, pushRecentSearch, clearRecentSearches } = useProfile();

  // Lock body scroll + autofocus
  useEffect(() => {
    document.documentElement.style.overflow = "hidden";
    inputRef.current?.focus();
    fetch("/api/restaurants?featured=1")
      .then((r) => r.json())
      .then((d) => setFeatured(d.restaurants ?? []))
      .catch(() => {});
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, []);

  // Debounced live search
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]));
    }, 220);
    return () => window.clearTimeout(t);
  }, [q]);

  const submit = useCallback(
    (value: string) => {
      const clean = value.trim();
      if (!clean) return;
      pushRecentSearch(clean);
      onClose();
      router.push(`/restaurants?q=${encodeURIComponent(clean)}`);
    },
    [onClose, pushRecentSearch, router],
  );

  const restaurants = results?.filter((r): r is RestaurantSearchResult => r.type === "restaurant") ?? [];
  const dishes = results?.filter((r): r is DishSearchResult => r.type === "dish") ?? [];
  const searching = q.trim().length >= 2;

  return (
    <div role="dialog" aria-modal="true" aria-label="Search" className="fixed inset-0 z-[80]">
      {/* backdrop */}
      <button
        aria-label="Close search"
        onClick={onClose}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/65 backdrop-blur-md"
      />

      {/* panel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-3 pt-3 md:pt-[10vh]">
        <div className="glass-strong animate-pop-in pointer-events-auto flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl md:max-h-[70vh]">
          {/* input row */}
          <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
            <Search className="size-5 shrink-0 text-ember-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(q);
                if (e.key === "Escape") onClose();
              }}
              placeholder="Search restaurants, dishes, cravings…"
              className="min-w-0 flex-1 bg-transparent text-base text-cream-50 placeholder:text-cream-500 focus:outline-none"
              aria-label="Search"
            />
            {q ? (
              <button type="button" onClick={() => setQ("")} aria-label="Clear" className="press rounded-full p-1 text-cream-400 hover:text-cream-50">
                <X className="size-4" />
              </button>
            ) : (
              <button type="button" onClick={onClose} aria-label="Close" className="press rounded-full p-1 text-cream-400 hover:text-cream-50">
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {!searching && (
              <div className="space-y-6">
                {recentSearches.length > 0 && (
                  <section>
                    <div className="mb-2.5 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                        <Clock3 className="size-3.5" /> Recent
                      </h3>
                      <button type="button" onClick={clearRecentSearches} className="press text-xs font-medium text-cream-500 hover:text-chili-400">
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentSearches.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => submit(s)}
                          className="press rounded-full bg-white/6 px-3.5 py-1.5 text-sm text-cream-200 transition-colors hover:bg-white/12"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                    <TrendingUp className="size-3.5" /> Trending cravings
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {TRENDING.map((s, i) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => submit(s)}
                        style={{ animationDelay: `${i * 40}ms` }}
                        className="press animate-rise rounded-full border border-white/10 bg-gradient-to-b from-white/8 to-transparent px-3.5 py-1.5 text-sm text-cream-200 transition-all hover:border-ember-400/40 hover:text-ember-300"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </section>

                {featured.length > 0 && (
                  <section>
                    <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                      <Flame className="size-3.5" /> Featured tonight
                    </h3>
                    <ul className="space-y-1">
                      {featured.slice(0, 4).map((r) => (
                        <li key={r.slug}>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              router.push(`/restaurants/${r.slug}`);
                            }}
                            className="press group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-white/6"
                          >
                            <span className="relative size-11 shrink-0 overflow-hidden rounded-xl">
                              <Image src={r.imageUrl} alt="" fill sizes="44px" className="object-cover" placeholder="blur" blurDataURL={BLUR} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-cream-50">{r.name}</span>
                              <span className="block truncate text-xs text-cream-500">{r.cuisines.join(" · ")}</span>
                            </span>
                            <ArrowRight className="size-4 text-cream-600 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ember-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}

            {searching && results === null && (
              <div className="space-y-3 py-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton size-11 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-3 w-1/3" />
                      <div className="skeleton h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searching && results !== null && results.length === 0 && (
              <div className="py-10 text-center">
                <p className="font-display text-lg font-semibold text-cream-200">No matches for “{q.trim()}”</p>
                <p className="mt-1 text-sm text-cream-500">Try a cuisine, a restaurant, or a dish name</p>
              </div>
            )}

            {searching && results !== null && results.length > 0 && (
              <div className="space-y-5">
                {restaurants.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">Restaurants</h3>
                    <ul className="space-y-1">
                      {restaurants.map((r, i) => (
                        <li key={r.slug}>
                          <button
                            type="button"
                            onClick={() => {
                              pushRecentSearch(q);
                              onClose();
                              router.push(`/restaurants/${r.slug}`);
                            }}
                            className="press group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-white/6"
                          >
                            <span className="relative size-12 shrink-0 overflow-hidden rounded-xl">
                              <Image src={r.imageUrl} alt="" fill sizes="48px" className="object-cover" placeholder="blur" blurDataURL={BLUR} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold text-cream-50">{r.name}</span>
                                {r.offer && (
                                  <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-chili-500/15 px-1.5 py-0.5 text-[10px] font-bold text-chili-300">
                                    <Percent className="size-2.5" /> Offer
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-cream-500">
                                <Star className="size-3 fill-gold-400 text-gold-400" /> {r.rating.toFixed(1)}
                                <span aria-hidden>·</span> {r.deliveryMinutes} min
                                <span aria-hidden>·</span> {r.cuisines.slice(0, 2).join(", ")}
                              </span>
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-cream-600 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ember-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {dishes.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">Dishes</h3>
                    <ul className="space-y-1">
                      {dishes.map((d, i) => (
                        <li key={`${d.id}-${d.name}`}>
                          <button
                            type="button"
                            onClick={() => {
                              pushRecentSearch(q);
                              onClose();
                              router.push(`/restaurants/${d.restaurantSlug}?dish=${d.id}`);
                            }}
                            className="press group animate-rise flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-white/6"
                            style={cssVars({ animationDelay: `${i * 55}ms` })}
                          >
                            <span className="relative size-12 shrink-0 overflow-hidden rounded-xl">
                              <Image src={d.imageUrl} alt="" fill sizes="48px" className="object-cover" placeholder="blur" blurDataURL={BLUR} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                {d.isVeg && <Leaf className="size-3 shrink-0 text-mint-400" />}
                                <span className="truncate text-sm font-semibold text-cream-50">{d.name}</span>
                              </span>
                              <span className="block truncate text-xs text-cream-500">
                                {d.restaurantName} · {formatINR(d.priceCents)}
                              </span>
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-cream-600 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ember-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <button
                  type="button"
                  onClick={() => submit(q)}
                  className="press flex w-full items-center justify-center gap-2 rounded-2xl bg-white/6 py-3 text-sm font-semibold text-ember-300 transition-colors hover:bg-white/10"
                >
                  See all results for “{q.trim()}” <ArrowRight className="size-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
