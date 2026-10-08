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

/**
 * Storage consent for a site that sets no tracking cookies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE ADDING A CATEGORY
 *
 * crave. sets no tracking cookies, runs no analytics and loads no third-party
 * trackers — its only cookie is an essential, `HttpOnly` sign-in session on the
 * partner console, which this consent surface does not govern — so there is no
 * cross-site profile to withhold. Everything this governs is `localStorage` on
 * the visitor's own device, which never reaches us unless they place an order.
 *
 * That is why the choice is phrased as "essential" vs "everything" rather than
 * accept/reject: nothing here is a tracker, and a reject button that implied we
 * would stop following the visitor would be a lie. What "essential only" really
 * does is stop recording favourites and recent searches.
 *
 * Every string in `held` is a factual claim about what this app writes to
 * storage. If you add a call to `localStorage.setItem`, add it here too — and if
 * it cannot honestly be called essential, it belongs under a category the
 * visitor can switch off.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Namespaced and versioned, matching the `crave.*` convention used elsewhere. */
export const CONSENT_STORAGE_KEY = "crave.consent.v1";

/**
 * Bump when `CONSENT_CATEGORIES` changes in substance. A stored record carrying
 * an older version is read as no decision at all, so widening the list asks the
 * visitor again rather than inheriting consent they never gave to the new items.
 */
export const CONSENT_VERSION = 1;

export type ConsentChoice = "all" | "essential";

export interface ConsentRecord {
  choice: ConsentChoice;
  version: number;
  decidedAt: string;
}

export interface ConsentCategory {
  id: "essential" | "personalisation";
  label: string;
  /** Required categories cannot be switched off, so they render without a toggle. */
  required: boolean;
  /** What this app actually writes, in the visitor's own words. */
  held: readonly string[];
}

export const CONSENT_CATEGORIES: readonly ConsentCategory[] = [
  {
    id: "essential",
    label: "Essential",
    required: true,
    held: [
      "what is in your cart",
      "the delivery area you picked",
      "your name, phone number and addresses, so you are not asked for them again at checkout",
      "codes for the orders you placed, so you can reopen them",
    ],
  },
  {
    id: "personalisation",
    label: "Favourites and recent searches",
    required: false,
    held: ["the restaurants you favourite", "the terms you last searched for"],
  },
];

/** The category a visitor can actually decline. Singular by design. */
export const OPTIONAL_CATEGORY_ID = "personalisation" as const;

/**
 * Parses the stored record, treating anything unrecognised as "not decided".
 *
 * Split out from `readRecord` and kept free of `localStorage` so the shape
 * rules can be tested directly — they are the part that matters, because
 * `localStorage` is user-writable. A hand-edited, stale or half-written value
 * must never be able to manufacture consent, and must never throw.
 */
export function parseConsentRecord(raw: string | null): ConsentRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { choice, version, decidedAt } = parsed as Partial<ConsentRecord>;
  if (version !== CONSENT_VERSION) return null;
  if (choice !== "all" && choice !== "essential") return null;
  return {
    choice,
    version: CONSENT_VERSION,
    decidedAt: typeof decidedAt === "string" ? decidedAt : "",
  };
}

function readRecord(): ConsentRecord | null {
  try {
    return parseConsentRecord(localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    // Storage access itself can throw — Safari private mode, disabled cookies.
    return null;
  }
}

interface ConsentContextValue {
  /**
   * False until the stored record has been read. Every consent surface must gate
   * on this: rendering "we already have your answer" before the read settles
   * would flash the banner at returning visitors on every page load.
   */
  hydrated: boolean;
  /** Null until this browser has been asked. */
  choice: ConsentChoice | null;
  /** True only on an explicit "accept everything". The gate on optional storage. */
  personalisationAllowed: boolean;
  decide: (choice: ConsentChoice) => void;
  /** Whether the full category sheet is open, so the footer can reopen it later. */
  preferencesOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<ConsentRecord | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    setRecord(readRecord());
    setHydrated(true);
  }, []);

  // Gated on `hydrated` so the initial null state cannot overwrite a stored
  // answer during the first render pass.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (record) localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
      else localStorage.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      /* Private mode, quota, or storage disabled. Nothing here is load-bearing. */
    }
  }, [record, hydrated]);

  const decide = useCallback((choice: ConsentChoice) => {
    setRecord({ choice, version: CONSENT_VERSION, decidedAt: new Date().toISOString() });
    setPreferencesOpen(false);
  }, []);

  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      hydrated,
      choice: record?.choice ?? null,
      personalisationAllowed: record?.choice === "all",
      decide,
      preferencesOpen,
      openPreferences,
      closePreferences,
    }),
    [hydrated, record, decide, preferencesOpen, openPreferences, closePreferences],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used within ConsentProvider");
  return ctx;
}
