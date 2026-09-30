/**
 * Runtime experiment switches for the profiling harness (Phases 13-14).
 *
 * Test A..E on the device lab need to disable exactly one surface at a time:
 *   B  EmberField only        C  Ambient only        D  both
 *   E  polling only
 *
 * These flags are read from `window.__PERF__`, which only the harness injects
 * before the page hydrates. Production is untouched: nothing in the app ever
 * sets `window.__PERF__`, so every check here defaults to "on". The checks are
 * synchronous and read the settings only when a component renders or an effect
 * runs, so re-enabling between runs needs nothing but a fresh page load.
 *
 * This module deliberately has no `"use client"` directive: it is read from
 * server-rendered components too (e.g. Ambient during prerender), and its
 * `window` guard keeps every access safe on the server. Client-bundled copies
 * of the same module take part in the hydration bundle via the import graph.
 */

export interface PerfOverrides {
  ember?: "off";
  ambient?: "off";
  polling?: "off";
}

declare global {
  interface Window {
    __PERF__?: PerfOverrides;
  }
}

function isOff(kind: keyof PerfOverrides): boolean {
  // SSR guard: `window` does not exist on the server, and these overrides only
  // ever apply after hydration anyway.
  if (typeof window === "undefined") return false;
  return window.__PERF__?.[kind] === "off";
}

export const experiments = {
  emberOff: () => isOff("ember"),
  ambientOff: () => isOff("ambient"),
  pollingOff: () => isOff("polling"),
};