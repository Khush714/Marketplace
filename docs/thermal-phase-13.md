# Phase 13 — Runtime profiling (harness + smoke evidence)

## What this phase produced

1. `src/lib/experiments.ts` — the A..E isolation switches. Read from
   `window.__PERF__`, which only the profiling harness sets before hydration;
   production is unchanged (nothing in the app writes `__PERF__`, every check
   defaults to "on"). No `"use client"` directive on purpose: Ambient reads it
   during server prerender, and the module's `typeof window` guard keeps those
   reads safe. (First attempt had the directive and broke the `/_not-found`
   prerender — `ambientOff is not a function` — because server component
   imports of client-module objects come across as unserializable references.)
2. `scripts/profiling/measure.mjs` — a Playwright + CDP recorder producing one
   JSON row per run: FPS (rAF over 60 frames), long-task count/ms
   (`PerformanceObserver`), request rate and bytes, JS heap / JS count deltas,
   DOM nodes / document / listener deltas (Memory domain), task/script/layout
   deltas (Performance domain). CPU throttling via CDP, device profile via
   iPhone-14 emulation, optional background-freeze for Test 7.
3. `scripts/profiling/README.md` — the full Phase 13 matrix (routes x 0/2/5/10
   min) and the Phase 14 runbook. Battery and temperature columns are lab-only:
   a desktop browser cannot read a device battery.

## Wire-up notes

- EmberField returns `null` when `experiments.emberOff()` (Test B/D).
- Ambient renders just the vignette + grain when `experiments.ambientOff()`
  (Test C/D); the four aurora layers and two drift accents are dropped.
- `useOrderPoll` bails before its first tick when `experiments.pollingOff()`
  (Test E).
- `window.__PERF__` is injected by `context.addInitScript` before any page
  script, so the choice is effective from hydration.

## Smoke pass (this machine, headless Chromium, iPhone-14 profile, CPU /4)

10-second windows — NOT the 10-min protocol, enough to prove the harness and
giving a first glance at the surfaces. Full rows in
`scripts/profiling/results-smoke.jsonl`.

| route  | cfg | fps  | long tasks (ms) | jsHeap Δ MB | notes |
|--------|-----|------|-----------------|-------------|-------|
| home   | base| 59.3 | 7 (914)         | +2.2        |       |
| home   | B   | 57.9 | 9 (1247)        | +0.6        | no-ember |
| home   | C   | 58.9 | 10 (1345)       | +1.1        | no-ambient |
| home   | D   | 56.9 | 9 (1221)        | +0.6        | no-ember+no-ambient |
| home   | E   | 60.6 | 6 (1118)        | +1.0        | no-polling |
| restaurant | base | 38.4 | 11 (1095)   | +0.2        | slug=nori-house, decode-heavy |
| orders | base | 59.6 | 7 (563)         | +0.4        |       |
| search | base | 19.4 | 11 (1329)       | +0.9        | overlay open |

Readings at 10 s are dominated by hydration/IPC settling, so A..E differences
are not meaningful yet — that is exactly why the Phase 13 matrix exists. Two
things already stand out and are worth the full 10-min treatment:

- Restaurant and the search overlay are the low-FPS surfaces (38.4 / 19.4)
  under CPU throttle — large image decode + a CSS backdrop-blur overlay, both
  of which Phase 10 had already pulled off the hot path visually.
- `reqMin` is 0 on every idle run and listeners/nodes deltas are 0 — the
  Phase 7/8/11 work holds under a real browser: no wakeups, no leak drift.

## Remaining (needs the device lab)

- The full 0/2/5/10-min × 5-route matrix and the A..E 10-min isolations.
- Battery/temperature and on-device CPU% columns (source "lab").
- Tests 4 (active tracking), 5 (continuous navigation), 6 (lock/unlock).