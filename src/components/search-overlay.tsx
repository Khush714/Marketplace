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
  Sparkles,
  Star,
  TrendingUp,
  X,
} from "lucide-react";
import { cn, formatINR, isUnrated, withLoc } from "@/lib/domain";
import { useLocation } from "@/lib/location";
import { cssVars } from "@/components/motion-primitives";
import {
  recentDishFromSearch,
  recentRestaurantFromSearch,
  type RecentDish,
  type RecentRestaurant,
} from "@/lib/recent-items";
import { useRecentItems, useSearchHistory } from "@/lib/profile";
import type {
  DishSearchResult,
  PublicPopularityDto,
  RestaurantDto,
  RestaurantSearchResult,
  SearchMatchKind,
  SearchResult,
  SearchSuggestion,
} from "@/lib/types";

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

function matchBadge(match: SearchMatchKind): string | null {
  if (match === "name") return null;
  if (match === "category") return "Category match";
  if (match === "cuisine") return "Cuisine match";
  if (match === "description") return "In description";
  return "In tagline";
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[] | null>(null);
  const [featured, setFeatured] = useState<RestaurantDto[]>([]);
  const [popularity, setPopularity] = useState<PublicPopularityDto | null>(null);
  // Backspacing through a word should not re-hit the search endpoint. Bounded
  // so a long session cannot grow the cache without limit.
  const suggestionCache = useRef(new Map<string, { results: SearchResult[]; suggestions: SearchSuggestion[] }>());
  const { recentSearches, pushRecentSearch, clearRecentSearches } = useSearchHistory();
  const {
    recentDishes,
    recentRestaurants,
    rememberDish,
    clearRecentDishes,
    clearRecentRestaurants,
  } = useRecentItems();
  const { locality } = useLocation();

  useEffect(() => {
    previousActiveElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    inputRef.current?.focus();

    return () => {
      document.documentElement.style.overflow = previousOverflow;
      previousActiveElement.current?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/restaurants?featured=1&loc=${locality.key}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setFeatured(d.restaurants ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [locality.key]);

  useEffect(() => {
    const controller = new AbortController();
    // Never let a previous locality's chips linger while the new scope loads.
    setPopularity(null);
    fetch(`/api/popularity?loc=${locality.key}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        const value = d?.popularity as PublicPopularityDto | undefined;
        setPopularity(value && Array.isArray(value.dishes) ? value : null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [locality.key]);

  useEffect(() => {
    const clean = q.trim();
    if (clean.length < 2) {
      setResults(null);
      setSuggestions(null);
      return;
    }

    const key = `${locality.key}:${clean.toLowerCase()}`;
    const cached = suggestionCache.current.get(key);
    if (cached) {
      setResults(cached.results);
      setSuggestions(cached.suggestions);
      return;
    }

    // Clear stale cards immediately. Abort alone cannot stop a response that
    // already resolved, so the `active` flag below is the final guard against a
    // slower earlier request painting over the current term.
    setResults(null);
    setSuggestions(null);

    let active = true;
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(clean)}&loc=${locality.key}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => {
          if (!active) return;
          const payload = {
            results: (d.results ?? []) as SearchResult[],
            suggestions: (d.suggestions ?? []) as SearchSuggestion[],
          };
          const cache = suggestionCache.current;
          if (cache.size >= 40) cache.delete(cache.keys().next().value as string);
          cache.set(key, payload);
          setResults(payload.results);
          setSuggestions(payload.suggestions);
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            setResults([]);
            setSuggestions([]);
          }
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(t);
      controller.abort();
    };
  }, [q, locality.key]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!active || !panelRef.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = useCallback(
    (value: string) => {
      const clean = value.trim();
      if (!clean) return;
      pushRecentSearch(clean);
      onClose();
      router.push(withLoc(`/restaurants?q=${encodeURIComponent(clean)}`, locality.key));
    },
    [onClose, pushRecentSearch, router, locality.key],
  );

  const openDish = useCallback(
    (dish: RecentDish) => {
      // Re-opening a recent dish moves it back to the front of the list.
      rememberDish(dish);
      onClose();
      router.push(`/restaurants/${dish.restaurantSlug}?dish=${dish.id}`);
    },
    [rememberDish, onClose, router],
  );

  const openRestaurant = useCallback(
    (restaurant: RecentRestaurant) => {
      onClose();
      router.push(`/restaurants/${restaurant.slug}`);
    },
    [onClose, router],
  );

  const restaurants = results?.filter((r): r is RestaurantSearchResult => r.type === "restaurant") ?? [];
  const dishes = results?.filter((r): r is DishSearchResult => r.type === "dish") ?? [];
  const searching = q.trim().length >= 2;

  return (
    <div id="search-dialog" role="dialog" aria-modal="true" aria-label="Search" className="fixed inset-0 z-[80]">
      {/* backdrop */}
      <button
        aria-label="Close search"
        onClick={onClose}
        className="animate-overlay-in absolute inset-0 cursor-default bg-black/65 backdrop-blur-md"
      />

      {/* panel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-[10vh]">
        <div
          ref={panelRef}
          className="glass-strong animate-pop-in pointer-events-auto flex max-h-[86dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl md:max-h-[70vh]"
          aria-busy={searching && results === null}
        >
          {/* input row */}
          <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
            <Search className="size-5 shrink-0 text-ember-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(q);
              }}
              placeholder="Search restaurants, dishes, cravings…"
              className="min-w-0 flex-1 bg-transparent text-base text-cream-50 placeholder:text-cream-500 focus:outline-none focus:ring-2 focus:ring-ember-400/60"
              aria-label="Search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searching && results !== null}
              aria-controls="search-results"
              autoComplete="off"
              spellCheck={false}
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

          <p className="sr-only" aria-live="polite">
            {searching
              ? results === null
                ? "Searching"
                : `${results.length} results, ${suggestions?.length ?? 0} suggestions`
              : "Search suggestions"}
          </p>

          <div id="search-results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {!searching && (
              <div className="space-y-6">
                {recentSearches.length > 0 && (
                  <section aria-label="Recent searches">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                        <Clock3 className="size-3.5" /> Recent searches
                      </h3>
                      <button
                        type="button"
                        onClick={clearRecentSearches}
                        aria-label="Clear recent searches"
                        className="press text-xs font-medium text-cream-500 hover:text-chili-400"
                      >
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

                {recentDishes.length > 0 && (
                  <section aria-label="Recent dishes">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                        <Clock3 className="size-3.5" /> Recent dishes
                      </h3>
                      <button
                        type="button"
                        onClick={clearRecentDishes}
                        aria-label="Clear recent dishes"
                        className="press text-xs font-medium text-cream-500 hover:text-chili-400"
                      >
                        Clear
                      </button>
                    </div>
                    <ul className="space-y-1">
                      {recentDishes.map((d) => (
                        <li key={`${d.id}:${d.restaurantSlug}`}>
                          <button
                            type="button"
                            onClick={() => openDish(d)}
                            aria-label={`Open recent dish ${d.name}`}
                            className="press group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-white/6"
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

                {recentRestaurants.length > 0 && (
                  <section aria-label="Recent restaurants">
                    <div className="mb-2.5 flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                        <Clock3 className="size-3.5" /> Recent restaurants
                      </h3>
                      <button
                        type="button"
                        onClick={clearRecentRestaurants}
                        aria-label="Clear recent restaurants"
                        className="press text-xs font-medium text-cream-500 hover:text-chili-400"
                      >
                        Clear
                      </button>
                    </div>
                    <ul className="space-y-1">
                      {recentRestaurants.map((r) => (
                        <li key={r.slug}>
                          <button
                            type="button"
                            onClick={() => openRestaurant(r)}
                            aria-label={`Open recent restaurant ${r.name}`}
                            className="press group flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-white/6"
                          >
                            <span className="relative size-12 shrink-0 overflow-hidden rounded-xl">
                              <Image src={r.imageUrl} alt="" fill sizes="48px" className="object-cover" placeholder="blur" blurDataURL={BLUR} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-cream-50">{r.name}</span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-cream-500">
                                {isUnrated(r.ratingsCount) ? (
                                  <>
                                    <Sparkles className="size-3 fill-ember-400 text-ember-400" /> New
                                  </>
                                ) : (
                                  <>
                                    <Star className="size-3 fill-gold-400 text-gold-400" /> {r.rating.toFixed(1)}
                                  </>
                                )}
                                <span aria-hidden>·</span> {r.deliveryMinutes} min
                                {r.cuisines.length > 0 && (
                                  <>
                                    <span aria-hidden>·</span>
                                    <span className="truncate">{r.cuisines.slice(0, 2).join(", ")}</span>
                                  </>
                                )}
                              </span>
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-cream-600 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ember-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {popularity && (
                  <section aria-label={`Trending in ${popularity.scopeLabel || locality.name}`}>
                    <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                      <TrendingUp className="size-3.5" /> Trending in {popularity.scopeLabel || locality.name}
                    </h3>
                    {popularity.dishes.length > 0 ? (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {popularity.dishes.slice(0, 8).map((dish, i) => (
                            <button
                              key={`${dish.id}:${dish.restaurantSlug}`}
                              type="button"
                              onClick={() => submit(dish.name)}
                              aria-label={`Search trending dish ${dish.name}`}
                              style={{ animationDelay: `${i * 40}ms` }}
                              className="press animate-rise rounded-full border border-white/10 bg-gradient-to-b from-white/8 to-transparent px-3.5 py-1.5 text-sm text-cream-200 transition-all hover:border-ember-400/40 hover:text-ember-300"
                            >
                              {dish.name}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-cream-600">
                          From real orders in the last {popularity.windowDays} days
                        </p>
                      </>
                    ) : (
                      <p className="text-xs leading-relaxed text-cream-600">
                        Local trends appear once enough orders have been placed here.
                      </p>
                    )}
                  </section>
                )}

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

            {searching && suggestions && suggestions.length > 0 && (
              <section aria-label="Search suggestions" className="border-b border-white/8 pb-3">
                <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">
                  <Sparkles className="size-3.5" /> Suggestions
                </h3>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {suggestions.map((s) => (
                    <button
                      key={`${s.kind}-${s.text}`}
                      type="button"
                      onClick={() => {
                        if (s.kind === "restaurant" && s.restaurantSlug) {
                          pushRecentSearch(q);
                          onClose();
                          router.push(`/restaurants/${s.restaurantSlug}`);
                          return;
                        }
                        submit(s.text);
                      }}
                      aria-label={s.kind === "restaurant" ? `Open ${s.text}` : `Search for ${s.text}`}
                      className="press flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-cream-200 transition-colors hover:border-ember-400/40 hover:text-ember-300"
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wider text-cream-500">{s.kind}</span>
                      <span className="max-w-40 truncate">{s.text}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {searching && results !== null && results.length === 0 && (suggestions?.length ?? 0) === 0 && (
              <div className="py-10 text-center">
                <p className="font-display text-lg font-semibold text-cream-200">No matches for “{q.trim()}”</p>
                <p className="mt-1 text-sm text-cream-500">Try a cuisine, a restaurant, or a dish name</p>
              </div>
            )}

            {searching && results !== null && results.length > 0 && (
              <div className="space-y-5 pt-4">
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
                              openDish(recentDishFromSearch(d));
                            }}
                            aria-label={`Open ${d.name} from ${d.restaurantName}`}
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
                              {matchBadge(d.match) && (
                                <span className="mt-1 inline-flex rounded-full bg-white/6 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cream-500">
                                  {matchBadge(d.match)}
                                </span>
                              )}
                            </span>
                            <ArrowRight className="size-4 shrink-0 text-cream-600 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ember-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {restaurants.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cream-500">Restaurants</h3>
                    <ul className="space-y-1">
                      {restaurants.map((r) => (
                        <li key={r.slug}>
                          <button
                            type="button"
                            onClick={() => {
                              pushRecentSearch(q);
                              openRestaurant(recentRestaurantFromSearch(r));
                            }}
                            aria-label={`Open ${r.name}`}
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
                                {isUnrated(r.ratingsCount) ? (
                                  <>
                                    <Sparkles className="size-3 fill-ember-400 text-ember-400" /> New
                                  </>
                                ) : (
                                  <>
                                    <Star className="size-3 fill-gold-400 text-gold-400" /> {r.rating.toFixed(1)}
                                  </>
                                )}
                                <span aria-hidden>·</span> {r.deliveryMinutes} min
                                <span aria-hidden>·</span> {r.cuisines.slice(0, 2).join(", ")}
                              </span>
                              {matchBadge(r.match) && (
                                <span className="mt-1 inline-flex rounded-full bg-white/6 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cream-500">
                                  {matchBadge(r.match)}
                                </span>
                              )}
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
