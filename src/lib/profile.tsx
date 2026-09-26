"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface Address {
  id: string;
  label: string;
  text: string;
}

/**
 * A placed order as this browser remembers it. The token is the signed
 * per-order credential (see lib/order-token) — without it the order can no
 * longer be read, so the pair is stored together and never separated.
 */
export interface StoredOrder {
  code: string;
  token: string;
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

interface ProfileContextValue extends ProfileState {
  hydrated: boolean;
  /** Codes only, for counters and links. Reading an order needs its token. */
  orderCodes: string[];
  setIdentity: (name: string, phone: string) => void;
  addAddress: (label: string, text: string) => Address;
  removeAddress: (id: string) => void;
  toggleFavorite: (slug: string) => void;
  isFavorite: (slug: string) => boolean;
  rememberOrder: (code: string, token: string) => void;
  pushRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
}

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

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfileState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

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

  const toggleFavorite = useCallback((slug: string) => {
    setState((s) => ({
      ...s,
      favorites: s.favorites.includes(slug)
        ? s.favorites.filter((f) => f !== slug)
        : [...s.favorites, slug],
    }));
  }, []);

  const isFavorite = useCallback(
    (slug: string) => state.favorites.includes(slug),
    [state.favorites],
  );

  const rememberOrder = useCallback((code: string, token: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setState((s) => ({
      ...s,
      orders: [{ code: clean, token, at: Date.now() }, ...s.orders.filter((o) => o.code !== clean)].slice(0, 30),
    }));
  }, []);

  const pushRecentSearch = useCallback((q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setState((s) => ({
      ...s,
      recentSearches: [clean, ...s.recentSearches.filter((r) => r.toLowerCase() !== clean.toLowerCase())].slice(0, 6),
    }));
  }, []);

  const clearRecentSearches = useCallback(() => {
    setState((s) => ({ ...s, recentSearches: [] }));
  }, []);

  const value = useMemo<ProfileContextValue>(
    () => ({
      ...state,
      hydrated,
      orderCodes: state.orders.map((o) => o.code),
      setIdentity,
      addAddress,
      removeAddress,
      toggleFavorite,
      isFavorite,
      rememberOrder,
      pushRecentSearch,
      clearRecentSearches,
    }),
    [state, hydrated, setIdentity, addAddress, removeAddress, toggleFavorite, isFavorite, rememberOrder, pushRecentSearch, clearRecentSearches],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}
