"use client";

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
import { DEFAULT_LOCALITY, LOCALITIES, localityByKey, localityNear, withLoc, type Locality } from "@/lib/domain";

const STORAGE_KEY = "crave.location.v1";

/** How the current locality was resolved. */
export type DetectStatus = "idle" | "detecting" | "served" | "out-of-range" | "denied";

interface SavedLocation {
  key: string;
  /** True only when the user picked it manually — auto-detected picks are re-checked against GPS. */
  manual: boolean;
}

function persistToStorage(saved: SavedLocation) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* ignore */
  }
}

function readStored(): SavedLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedLocation>;
    if (typeof parsed?.key === "string" && LOCALITIES.some((l) => l.key === parsed.key)) {
      return { key: parsed.key, manual: parsed.manual === true };
    }
    return null;
  } catch {
    return null;
  }
}

interface LocationContextValue {
  /** The active delivery locality (always resolved — never null). */
  locality: Locality;
  /** True once the client has resolved the location from URL/storage/geolocation. */
  hydrated: boolean;
  /** True while the browser is querying GPS. */
  detecting: boolean;
  autoDetected: boolean;
  status: DetectStatus;
  /** True when GPS resolved to a place we don't deliver to (or permission was denied). */
  notServed: boolean;
  /** Explicitly choose a delivery area (persists + syncs the URL). */
  setLocality: (key: string) => void;
  /** Ask the browser for fresh GPS and snap to the nearest known locality. */
  detect: () => void;
  /** Open the Zomato-style area picker. */
  openPicker: () => void;
  closePicker: () => void;
  isPickerOpen: boolean;
}

const LocationContext = createContext<LocationContextValue | null>(null);

function readUrlLoc(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("loc");
  } catch {
    return null;
  }
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [locality, setLocalityState] = useState<Locality>(DEFAULT_LOCALITY);
  const [hydrated, setHydrated] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [status, setStatus] = useState<DetectStatus>("idle");
  const [isPickerOpen, setPickerOpen] = useState(false);
  const bootstrapped = useRef(false);

  const syncUrl = useCallback(
    (key: string) => {
      // Keep the current path + nav params, only touch ?loc=.
      const next = withLoc(window.location.pathname + window.location.search, key);
      if (`${window.location.pathname}${window.location.search}` !== next) {
        router.replace(next, { scroll: false });
      }
    },
    [router],
  );

  const apply = useCallback(
    (key: string, opts?: { manual?: boolean; sync?: boolean }) => {
      const loc = localityByKey(key);
      setLocalityState(loc);
      persistToStorage({ key, manual: opts?.manual === true });
      setDetecting(false);
      if (opts?.manual) setAutoDetected(false);
      if (opts?.sync !== false) syncUrl(key);
    },
    [syncUrl],
  );

  /** Geolocation success handler — snap only inside {@link DELIVERY_RADIUS_KM}. */
  const onGeoSuccess = useCallback(
    (lat: number, lng: number) => {
      const match = localityNear(lat, lng);
      if (match.served) {
        setAutoDetected(true);
        setStatus("served");
        apply(match.locality.key, { sync: true });
      } else {
        setStatus("out-of-range");
      }
    },
    [apply],
  );

  const onGeoError = useCallback(() => {
    setStatus("denied");
    setDetecting(false);
  }, []);

  /**
   * First-load resolution, Zomato order:
   *   1. ?loc= in the URL (open/share links win)
   *   2. a previously saved *manual* pick in localStorage
   *   3. browser geolocation snapped to the nearest served locality (auto-refine)
   *   4. city default (no auto-snap — user picks an area if we don't serve them)
   *
   * Auto-detected picks are not trusted across sessions — GPS re-runs so a user
   * who travels never gets stuck on an old "suggested" area.
   */
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const urlLoc = readUrlLoc();
    if (urlLoc && LOCALITIES.some((l) => l.key === urlLoc)) {
      apply(urlLoc, { sync: false });
      setHydrated(true);
      return;
    }

    const stored = readStored();
    if (stored?.manual) {
      apply(stored.key, { sync: true });
      setHydrated(true);
      return;
    }

    if ("geolocation" in navigator) {
      setDetecting(true);
      setStatus("detecting");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          onGeoSuccess(pos.coords.latitude, pos.coords.longitude);
          setDetecting(false);
          setHydrated(true);
        },
        () => {
          onGeoError();
          setHydrated(true);
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
      );
    } else {
      setStatus("denied");
      setHydrated(true);
    }
  }, [apply, onGeoSuccess, onGeoError]);

  const setLocality = useCallback(
    (key: string) => {
      setStatus("served");
      apply(key, { manual: true });
      setPickerOpen(false);
    },
    [apply],
  );

  const detect = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("denied");
      return;
    }
    setDetecting(true);
    setStatus("detecting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onGeoSuccess(pos.coords.latitude, pos.coords.longitude);
        setDetecting(false);
      },
      () => {
        onGeoError();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }, [onGeoSuccess, onGeoError]);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const notServed = status === "out-of-range" || status === "denied";

  const value = useMemo<LocationContextValue>(
    () => ({
      locality,
      hydrated,
      detecting,
      autoDetected,
      status,
      notServed,
      setLocality,
      detect,
      openPicker,
      closePicker,
      isPickerOpen,
    }),
    [locality, hydrated, detecting, autoDetected, status, notServed, setLocality, detect, openPicker, closePicker, isPickerOpen],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used within LocationProvider");
  return ctx;
}