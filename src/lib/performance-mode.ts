"use client";

import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ */
/*  Performance Mode — one classification, one set of listeners        */
/* ------------------------------------------------------------------ */

/**
 * Phase 12 — the app's single answer to "what can this device afford?".
 *
 * Previously every surface ran its own probe: the ember field detected a tier
 * with its own `matchMedia`/`navigator` reads and its own resize listener, each
 * `useReducedMotion()` subscriber attached its own media-query listener, the
 * scroll progress rail and the fly-to-cart effect each did an inline
 * `matchMedia` read. That is the "dozens of unrelated isMobile checks" this
 * replaces.
 *
 * Surfaces still express their own visual *tuning* (a CSS breakpoint for first
 * paint, an ember budget, a blur radius) but the *classification* — full /
 * balanced / low — lives here and nowhere else.
 *
 *   full      strong fine-pointer device            → 60fps, all effects
 *   balanced  touch devices and weaker desktops     → 30fps, reduced effects
 *   low       reduced-motion, save-data, weak cores → static / minimal
 *
 * The listeners are a single shared set: one resize listener, one media-query
 * listener each for reduced-motion and pointer type. As many components as like
 * may subscribe; none of them allocate their own.
 */

export type PerformanceMode = "full" | "balanced" | "low";

export interface PerformanceSnapshot {
  mode: PerformanceMode;
  reducedMotion: boolean;
  coarsePointer: boolean;
  /** Viewport ≥ 820px wide — the tablet/phone boundary used by the ember budgets. */
  largeViewport: boolean;
  lowPower: boolean;
}

const SERVER_SNAPSHOT: PerformanceSnapshot = {
  mode: "full",
  reducedMotion: false,
  coarsePointer: false,
  largeViewport: false,
  lowPower: false,
};

/** Reused when nothing changed, so subscribing components do not re-render. */
let current: PerformanceSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let started = false;

function readSignal(key: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(key).matches;
}

function computeSnapshot(): PerformanceSnapshot {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  const saved =
    (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const next: PerformanceSnapshot = {
    reducedMotion: readSignal("(prefers-reduced-motion: reduce)"),
    coarsePointer: readSignal("(pointer: coarse)"),
    largeViewport: window.innerWidth >= 820,
    lowPower: saved || (window.innerWidth <= 480 && (navigator.hardwareConcurrency ?? 8) <= 4),
    mode: "full",
  };
  // Working backwards keeps the low wins explicit:
  //   low        reduced-motion or save-data or a small weak device
  //   balanced   everything without a fine pointer (touch), or a weak desktop
  //   full       strong fine-pointer devices only
  if (next.reducedMotion || next.lowPower) next.mode = "low";
  else if (!next.coarsePointer && (navigator.hardwareConcurrency ?? 8) <= 4) next.mode = "balanced";
  else if (next.coarsePointer) next.mode = "balanced";
  else next.mode = "full";

  if (
    next.mode === current.mode &&
    next.reducedMotion === current.reducedMotion &&
    next.coarsePointer === current.coarsePointer &&
    next.largeViewport === current.largeViewport &&
    next.lowPower === current.lowPower
  ) {
    return current;
  }
  return next;
}

function subscribe(onStoreChange: () => void): () => void {
  if (listeners.size === 0) {
    current = computeSnapshot();
    window.addEventListener("resize", onSignalChange);
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .addEventListener("change", onSignalChange);
    window.matchMedia("(pointer: coarse)").addEventListener("change", onSignalChange);
    started = true;
  }
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && started) {
      window.removeEventListener("resize", onSignalChange);
      window
        .matchMedia("(prefers-reduced-motion: reduce)")
        .removeEventListener("change", onSignalChange);
      window.matchMedia("(pointer: coarse)").removeEventListener("change", onSignalChange);
      started = false;
    }
  };
}

function onSignalChange(): void {
  current = computeSnapshot();
  for (const cb of listeners) cb();
}

/**
 * Subscribe to the current performance classification. Returns a referentially
 * stable snapshot unless a signal actually changed, so a resize that does not
 * cross a boundary does not re-render subscribers.
 */
export function usePerformanceMode(): PerformanceSnapshot {
  return useSyncExternalStore(subscribe, () => current, () => SERVER_SNAPSHOT);
}

/**
 * Synchronous reduced-motion check for event handlers (fly-to-cart, etc.) that
 * cannot use the hook. Reads the media query live, which matches what the old
 * inline checks did, but keeps the query string in this one module.
 */
export function isReducedMotion(): boolean {
  return readSignal("(prefers-reduced-motion: reduce)");
}