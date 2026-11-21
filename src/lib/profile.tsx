"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { useConsent } from "@/lib/consent";

export interface Address {
  id: string;
  label: string;
  text: string;
}

/**
 * A placed order as this browser remembers it. The token is the signed
 * per-order credential (see lib/order-token) — without it the order can no
 * longer be read or cancelled, so the pair is stored together and never
 * separated. `trackingToken` (Phase 6) is the shareable bearer token behind
 * `/order/<tracking-token>`; pre-existing orders simply don't have one yet, so
 * they fall back to code+token URLs.
 */
export interface StoredOrder {
  code: string;
  token: string;
  trackingToken?: string;
  at: number;
}

interface ProfileState {
  name: string;
  phone: string;
  addresses: Address[];
  favorites: string[]; // restaurant slugs
  orders: StoredOrder[]; // most recent first
  recentSearches: string[];
}

/* ------------------------------------------------------------------ */
/*  Per-slice contexts                                                 */
/* ------------------------------------------------------------------ */

/*
 * Phase 8 — why this file publishes five contexts instead of one.
 *
 * Everything below is a single `ProfileState` object on purpose: it is one
 * localStorage record, and splitting the *state* would mean several writes that
 * could disagree with each other. But publishing it through one context meant
 * that writing any single field invalidated the value for every reader, because
 * the value is rebuilt from the whole object:
 *
 *   pushRecentSearch()  ->  new `state`  ->  new context value  ->  every
 *   useProfile() consumer re-renders, including every restaurant card on the
 *   page — all because a search string was appended.
 *
 * `pushRecentSearch` runs on every search commit, `rememberOrder` on every
 * placed order and `toggleFavorite` on every heart tap, while the consumers are
 * card grids (each one wrapped in a rAF-driven `TiltCard`) and the sticky
 * header. So the cost was paid by the largest subtrees in the app, on writes
 * that had nothing to do with them.
 *
 * The fix is to publish each slice under its own context, so React only notifies
 * the readers of the slice that actually changed. `useProfile()` still exists
 * and still returns everything, for the one page that genuinely needs the lot.
 */

interface ProfileReadyValue {
  hydrated: boolean;
}

interface ProfileIdentityValue {
  name: string;
  phone: string;
  addresses: Address[];
  setIdentity: (name: string, phone: string) => void;
  addAddress: (label: string, text: string) => Address;
  removeAddress: (id: string) => void;
}

interface FavoritesValue {
  favorites: string[];
  isFavorite: (slug: string) => boolean;
  toggleFavorite: (slug: string) => void;
}

interface ProfileOrdersValue {
  orders: StoredOrder[];
  /** Codes only, for counters and links. Reading an order needs its token. */
  orderCodes: string[];
  rememberOrder: (code: string, token: string, trackingToken?: string) => void;
}

interface SearchHistoryValue {
  recentSearches: string[];
  pushRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
}

interface ProfilePersonalisationValue {
  /**
   * Drops everything the "favourites and recent searches" consent category
   * covers. Called when a visitor switches that category off — see
   * `src/lib/consent.tsx`. Identity, addresses and order codes are deliberately
   * untouched: they are in the essential category.
   */
  clearPersonalisation: () => void;
}

type ProfileContextValue = ProfileReadyValue &
  ProfileIdentityValue &
  FavoritesValue &
  ProfileOrdersValue &
  SearchHistoryValue &
  ProfilePersonalisationValue;

const KEY = "crave.profile.v1";
const EMPTY: ProfileState = {
  name: "",
  phone: "",
  addresses: [
    {
      id: "addr-default",
      label: "Home",
      text: "12, Station Road, Old City, Bharuch, Gujarat 392001",
    },
  ],
  favorites: [],
  orders: [],
  recentSearches: [],
};

const ProfileReadyContext = createContext<ProfileReadyValue | null>(null);
const ProfileIdentityContext = createContext<ProfileIdentityValue | null>(null);
const FavoritesContext = createContext<FavoritesValue | null>(null);
const ProfileOrdersContext = createContext<ProfileOrdersValue | null>(null);
const SearchHistoryContext = createContext<SearchHistoryValue | null>(null);
const ProfilePersonalisationContext = createContext<ProfilePersonalisationValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfileState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  // One read, not a subscription: this only ever gates the two optional writes
  // below, and the banner that changes it lives above this provider.
  const { personalisationAllowed } = useConsent();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ProfileState> & { orderCodes?: string[] };
        setState({
          ...EMPTY,
          ...parsed,
          addresses: parsed.addresses?.length ? parsed.addresses : EMPTY.addresses,
          // Legacy builds stored bare codes. Those orders are unreachable now
          // (a code alone is not a credential), so they are dropped instead of
          // being shown as permanently unloadable rows.
          orders: Array.isArray(parsed.orders) ? parsed.orders.filter((o) => o?.code && o?.token) : [],
        });
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, hydrated]);

  const setIdentity = useCallback((name: string, phone: string) => {
    setState((s) => ({ ...s, name, phone }));
  }, []);

  const addAddress = useCallback((label: string, text: string) => {
    const addr: Address = { id: `addr-${Date.now()}`, label: label || "Other", text };
    setState((s) => ({ ...s, addresses: [...s.addresses, addr] }));
    return addr;
  }, []);

  const removeAddress = useCallback((id: string) => {
    setState((s) => ({ ...s, addresses: s.addresses.filter((a) => a.id !== id) }));
  }, []);

  const toggleFavorite = useCallback(
    (slug: string) => {
      if (!personalisationAllowed) return;
      setState((s) => ({
        ...s,
        favorites: s.favorites.includes(slug)
          ? s.favorites.filter((f) => f !== slug)
          : [...s.favorites, slug],
      }));
    },
    [personalisationAllowed],
  );

  const isFavorite = useCallback(
    (slug: string) => personalisationAllowed && state.favorites.includes(slug),
    [personalisationAllowed, state.favorites],
  );

  const rememberOrder = useCallback((code: string, token: string, trackingToken?: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setState((s) => ({
      ...s,
      orders: [
        { code: clean, token, ...(trackingToken ? { trackingToken } : {}), at: Date.now() },
        ...s.orders.filter((o) => o.code !== clean),
      ].slice(0, 30),
    }));
  }, []);

  // Gated on consent, not merely suppressed in the UI: the recent-search list is
  // written on every submit, so leaving the write in place would keep recording
  // the terms a visitor declined to keep. The search itself still runs — callers
  // ignore this and navigate regardless.
  const pushRecentSearch = useCallback(
    (q: string) => {
      const clean = q.trim();
      if (!clean || !personalisationAllowed) return;
      setState((s) => ({
        ...s,
        recentSearches: [clean, ...s.recentSearches.filter((r) => r.toLowerCase() !== clean.toLowerCase())].slice(0, 6),
      }));
    },
    [personalisationAllowed],
  );

  const clearRecentSearches = useCallback(() => {
    setState((s) => ({ ...s, recentSearches: [] }));
  }, []);

  const clearPersonalisation = useCallback(() => {
    setState((s) =>
      s.favorites.length === 0 && s.recentSearches.length === 0
        ? s
        : { ...s, favorites: [], recentSearches: [] },
    );
  }, []);

  // Each value is memoised on its own slice only, so a write to one slice
  // cannot invalidate the context of another.
  const readyValue = useMemo<ProfileReadyValue>(() => ({ hydrated }), [hydrated]);

  const identityValue = useMemo<ProfileIdentityValue>(
    () => ({ name: state.name, phone: state.phone, addresses: state.addresses, setIdentity, addAddress, removeAddress }),
    [state.name, state.phone, state.addresses, setIdentity, addAddress, removeAddress],
  );

  const favoritesValue = useMemo<FavoritesValue>(
    () => ({ favorites: state.favorites, isFavorite, toggleFavorite }),
    [state.favorites, isFavorite, toggleFavorite],
  );

  const orderCodes = useMemo(() => state.orders.map((o) => o.code), [state.orders]);
  const ordersValue = useMemo<ProfileOrdersValue>(
    () => ({ orders: state.orders, orderCodes, rememberOrder }),
    [state.orders, orderCodes, rememberOrder],
  );

  const searchValue = useMemo<SearchHistoryValue>(
    () => ({ recentSearches: state.recentSearches, pushRecentSearch, clearRecentSearches }),
    [state.recentSearches, pushRecentSearch, clearRecentSearches],
  );

  const personalisationValue = useMemo<ProfilePersonalisationValue>(
    () => ({ clearPersonalisation }),
    [clearPersonalisation],
  );

  return (
    <ProfileReadyContext.Provider value={readyValue}>
      <ProfileIdentityContext.Provider value={identityValue}>
        <FavoritesContext.Provider value={favoritesValue}>
          <ProfileOrdersContext.Provider value={ordersValue}>
            <SearchHistoryContext.Provider value={searchValue}>
              <ProfilePersonalisationContext.Provider value={personalisationValue}>
                {children}
              </ProfilePersonalisationContext.Provider>
            </SearchHistoryContext.Provider>
          </ProfileOrdersContext.Provider>
        </FavoritesContext.Provider>
      </ProfileIdentityContext.Provider>
    </ProfileReadyContext.Provider>
  );
}

function useSlice<T>(ctx: Context<T | null>, name: string): T {
  const value = useContext(ctx);
  if (!value) throw new Error(`${name} must be used within ProfileProvider`);
  return value;
}

/** Hydration gate only. Settles once, so subscribers effectively stop rendering. */
export function useProfileReady(): boolean {
  return useSlice(ProfileReadyContext, "useProfileReady").hydrated;
}

export function useProfileIdentity(): ProfileIdentityValue {
  return useSlice(ProfileIdentityContext, "useProfileIdentity");
}

export function useFavorites(): FavoritesValue {
  return useSlice(FavoritesContext, "useFavorites");
}

export function useProfileOrders(): ProfileOrdersValue {
  return useSlice(ProfileOrdersContext, "useProfileOrders");
}

export function useSearchHistory(): SearchHistoryValue {
  return useSlice(SearchHistoryContext, "useSearchHistory");
}

/**
 * Everything, for screens that legitimately need the whole profile (the profile
 * page) and for the one place that has to act on consent across slices at once
 * (`ConsentSurface`). Subscribes to all five slices, so it re-renders on any
 * profile change — which is correct for those callers, but why leaf consumers
 * should prefer the narrow hooks above.
 */
export function useProfile(): ProfileContextValue {
  return {
    ...useSlice(ProfileReadyContext, "useProfile"),
    ...useSlice(ProfileIdentityContext, "useProfile"),
    ...useSlice(FavoritesContext, "useProfile"),
    ...useSlice(ProfileOrdersContext, "useProfile"),
    ...useSlice(SearchHistoryContext, "useProfile"),
    ...useSlice(ProfilePersonalisationContext, "useProfile"),
  };
}
