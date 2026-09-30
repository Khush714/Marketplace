# Thermal Optimization — Phase 11 (Memory Leaks) + Phase 12 (Performance Mode)

**Status:** complete.
**Code changes:**
- `src/app/api/integrations/payments/webhook/route.ts` — pruned the rate-limiter map (the one
  real leak found).
- `src/lib/performance-mode.ts` — **new**: the app's single performance classification.
- `src/components/ember-field.tsx`, `motion-primitives.tsx`, `scroll-progress.tsx`,
  `src/lib/fly-to-cart.ts` — migrated onto it.
**Validation:** `npx tsc --noEmit`, ESLint on all touched files, `npm run build` — all clean.

---

## 1. Phase 11 — memory-leak investigation

The failure mode to catch: *mount → allocate → unmount → resource remains*, so every repeated
mount lays down another copy until timers/listeners/RAF loops accumulate. After Phase 9's
cleanup audit there was no leak of *un-cleaned* listeners, so this phase pushed on the two
remaining shapes — cross-mount accumulation and unbounded collection growth.

### 1.1 Listener / timer / RAF accumulation across mounts — **clean**

Every client component that acquires a browser resource releases it in its effect cleanup, so a
route loaded, left and reloaded lays down exactly the same set again and never a second copy.
Verified per file in Phase 9; re-confirmed here for the always-mounted shell (header scroll,
scroll-progress, ember field) and the mount/unmount-heavy screens (tracking, search overlay,
dish sheet, payment stage, menu browser).

### 1.2 Never-trimmed collections — one real leak, fixed

| Collection | Cap | Verdict |
|---|---|---|
| Toasts | `slice(-2)` → ≤3 live | OK |
| `recentSearches` | `slice(0, 6)` | OK |
| `rememberOrder` history | `slice(0, 30)` + code dedupe | OK |
| Courier trail points | fixed-length map (3) | OK |
| `Scramble` timers | cleared per run + on cleanup | OK |
| Fly-to-cart DOM | elements `remove()` on `finish`/`cancel` | OK — transient WAAPI |
| **Webhook rate limiter `requestWindows` Map** | **entries were never pruned** | **FIXED** |

`src/app/api/integrations/payments/webhook/route.ts:49` keyed a `Map<string, number[]>` by
source IP. The per-IP arrays were window-filtered, but an entry was written for every IP that
ever sent a webhook and **never deleted** — the module-scoped map grew without bound for the
lifetime of the process, exactly the *mount → allocate → never reclaimed* shape. The fix deletes
the entry the moment its last timestamp falls out of the window. Residual (accepted): one entry
per every *distinct* IP that ever hit the route survives until that IP sends again and quiets
down; webhook senders are few and static, and a process restart clears it, so severity is low —
but the unbounded growth is gone.

### 1.3 Accepted by design

- `instrumentation.ts` drain `setInterval` — one timer per process, must outlive requests.
- `RevealObserver` — elements are `io.unobserve`d on reveal; the observer itself is single.

---

## 2. Phase 12 — one performance classification

### 2.1 Concept

`src/lib/performance-mode.ts` exports the app's single device answer:

```
full       strong fine-pointer device                → every effect, high budgets
balanced   touch devices (phone+iPad) / weak desktop → reduced effects, 30fps
low        reduced-motion, save-data, weak small     → static / minimal
PerformanceMode
```

The snapshot a component subscribes to is `{ mode, reducedMotion, coarsePointer, largeViewport,
lowPower }`. Consumers keep their own *tuning*; they no longer probe the device.

**One listener set for the whole app.** A single shared resize listener plus two media-query
listeners (`prefers-reduced-motion`, `pointer`) back every subscriber, and are removed when the
last subscriber unsubscribes. The snapshot reference only changes when a signal actually
crossed a boundary, so a resize that changes nothing re-renders nobody.

**SSR-safe hydration:** the server renders against a static snapshot; `useSyncExternalStore`
re-indicates the real one after mount. CSS tiering (ambient/hero breakpoints) intentionally
stays in CSS — it must decide before first paint, which JS cannot.

### 2.2 Migrations

| Surface | Before | After |
|---|---|---|
| Ember field | own `detectTier()` (`matchMedia`+`navigator`)+ own resize listener + tier state | tier derived from shared mode (`full→desktop`, `low→lowPower`, `balanced→tablet/mobile` by ≥820px). Budgets unchanged; its own resize listener removed |
| `useReducedMotion()` | one `matchMedia` listener per `TiltCard`/`Magnetic`/`CountUp`/`Scramble` instance | one shared subscription |
| Scroll progress | inline `matchMedia` read | shared `reducedMotion` |
| Fly-to-cart | inline `matchMedia` read | shared `isReducedMotion()` (event-safe read) |

### 2.3 Deliberate behaviour deltas (all conservative)

- A weak desktop (≤4 cores, fine pointer) is now **balanced** (30fps) instead of unconditionally
  full.
- `save-data` now also demotes fine-pointer devices to **low**; previously the coarse-pointer
  guard meant a desktop with data saver kept full effects.
- Otherwise the classifications reproduce Phase 3's ember budgets exactly, so no visual
  regression on the tiers that shipped.

---

## 3. Files touched

```
M src/app/api/integrations/payments/webhook/route.ts   (Phase 11 leak fix)
A src/lib/performance-mode.ts                          (Phase 12)
M src/components/ember-field.tsx
M src/components/motion-primitives.tsx
M src/components/scroll-progress.tsx
M src/lib/fly-to-cart.ts
```