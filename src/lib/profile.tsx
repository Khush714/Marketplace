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

interface ProfileState {
  name: string;
  phone: string;
  addresses: Address[];
  favorites: string[]; // restaurant slugs
  orderCodes: string[]; // most recent first
  recentSearches: string[];
}

interface ProfileContextValue extends ProfileState {
  hydrated: boolean;
  setIdentity: (name: string, phone: string) => void;
  addAddress: (label: string, text: string) => Address;
  removeAddress: (id: string) => void;
  toggleFavorite: (slug: string) => void;
  isFavorite: (slug: string) => boolean;
  rememberOrder: (code: string) => void;
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
      text: "221-B, 100 Feet Road, Indiranagar, Bengaluru 560038",
    },
  ],
  favorites: [],
  orderCodes: [],
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
        const parsed = JSON.parse(raw) as Partial<ProfileState>;
        setState({ ...EMPTY, ...parsed, addresses: parsed.addresses?.length ? parsed.addresses : EMPTY.addresses });
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

  const rememberOrder = useCallback((code: string) => {
    setState((s) => ({ ...s, orderCodes: [code, ...s.orderCodes.filter((c) => c !== code)].slice(0, 30) }));
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
