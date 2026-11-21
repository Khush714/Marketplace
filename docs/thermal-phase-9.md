# Thermal Optimization — Phase 9 & 10 — Listener/Resource Cleanup + Realtime Audit

**Status:** audit complete.
**Code change in this phase:** one — collapsed the duplicate `visibilitychange`
hook in the tracking screen onto the shared one (`src/components/tracking-view.tsx`).
**Validation:** `npx tsc --noEmit` clean; ESLint clean; not otherwise exercised by a live device.

---

## 1. Why this phase exists

Timer/listener leaks are cheap to ship and silent: a `setInterval` keeps a route handler
alive, a `visibilitychange` snapshot keeps two listeners where one would do, and a realtime
client keeps a socket open long after the screen that subscribed is gone. This phase sweeps
every such resource in the project and pins each to its lifecycle. Phase 10 then answers the
specific question of whether anything is *subscribing* when it should be *polling* — and what
realtime surface actually exists here.

---

## 2. Inventory (Phase 9) — every resource and its lifecycle

`MOUNT → START → USE → UNMOUNT/HIDDEN → CLEANUP` is met unless noted.

### Client-side (React components)

| Owner | Resource | Lifecycle | Verdict |
|---|---|---|---|
| `lib/toast.tsx:48` | `setTimeout` (3.2s auto-dismiss) | Fires once per toast, no explicit clear | Benign — bounded (≤3 live toasts), provider is app-lifetime, view is the toast itself |
| `lib/order-access.ts` `useDocumentVisible` | `visibilitychange` | add + remove ✓ | OK (Phase 7) |
| `lib/order-access.ts` `useOrderPoll` | recursive `setTimeout` | cleared in effect cleanup; loop torn down on hidden and on terminal order ✓ | OK (Phase 7) — never overlaps requests by construction |
| `components/ember-field.tsx:98,263-270` | `resize`, `visibilitychange`, rAF | all removed/cancelled on unmount; rAF fully stopped (not just skipped) while hidden ✓ | OK (Phase 3) |
| `components/tracking-view.tsx` `CourierMap` | rAF courier loop + `visibilitychange` | stopped on arrival / hidden / delivered; listener removed ✓ | OK (Phase 2). **This phase:** visibility hook de-duplicated onto the shared `useDocumentVisible` — the tracking screen previously registered a second equivalent `visibilitychange` listener |
| `components/scroll-progress.tsx:37-42` | `scroll`, `resize`, rAF | demand-driven (stops when converged), all removed/cancelled ✓ | OK |
| `components/site-header.tsx:49-50` | `scroll` (passive) | removed ✓ | OK — `setState(scrollY > 10)` bails out when the boolean is unchanged, so it does not re-render on every scroll delta |
| `components/dish-sheet.tsx:52` | `keydown` | removed ✓ | OK |
| `components/payment-stage.tsx:66` | `keydown` | removed ✓ | OK |
| `components/search-overlay.tsx:66,168` | `keydown` | removed ✓ | OK |
| `components/search-overlay.tsx:123` | debounce `setTimeout` + `AbortController` | timeout cleared, fetch aborted on effect re-run/unmount ✓ | OK |
| `components/menu-browser.tsx:29` | `IntersectionObserver` | `disconnect()` ✓ | OK |
| `components/menu-browser.tsx:63` | highlight `setTimeout` (5s) | `clearTimeout` ✓ | OK |
| `components/menu-browser.tsx:60,72` | scroll-spy re-enable `setTimeout` (~0.6–0.7s) | not tracked, not cleared | Benign — writes a ref boolean only, no state, no persistence after completion |
| `components/motion-primitives.tsx` | media-query `change` (`useReducedMotion`), 6 pointer listeners + rAF (`TiltCard`), 2 pointer + rAF (`Magnetic`), rAF (`CountUp`), `setInterval` + timers (`Scramble`) | all removed/cancelled ✓ | OK |
| `components/motion-primitives.tsx:180-214` `RevealObserver` | global `IntersectionObserver` **+ `MutationObserver` on `document.body` `{subtree:true}`**, with a 90ms-debounced rescan | both disconnected on unmount; each revealed element is `io.unobserve`d permanently | Accepted (by design) — the one whole-page watcher. Post-reveal scans are a single `querySelectorAll` and find nothing; see §3 |
| `components/location.tsx` picker split | context state only, no listeners | — | Phase 8 |

### Server-side (Node, request- or process-scoped)

| Owner | Resource | Lifecycle | Verdict |
|---|---|---|---|
| `lib/pos-bridge.ts:68`, `integrations/pos/*`, `integrations/payments/*` | `setTimeout` → `AbortController.abort` timeouts | **all** `clearTimeout(timer)` in `finally` ✓ (verified across payment-bridge, order-cancel, client, refund, provider-session) | OK |
| `instrumentation.ts:62` | `setInterval` sweeping POS deliveries | process lifetime by design; single instance per process | Accepted — this is the sweep engine, not an app route; it is also the pre-existing Edge Runtime warning source |
| `lib/razorpay-checkout.ts:249` | `setTimeout` poll loop awaiting payment session | request-scoped; ends when its API handler ends | OK — bounded, not a subscription |

### Absent (verified by search)

`ResizeObserver`, `WebSocket`, `EventSource`, Supabase clients, `supabase.channel(...)` and any
realtime `subscribe(...)` — **zero matches** across `src`. All `.from(...)` hits in the repo are
Drizzle table references in server queries, i.e. per-request SQL, not live connections.

---

## 3. Accepted background work (deliberate, bounded)

- **`RevealObserver`** is one shared engine for both server and client-rendered reveal elements.
  Its MutationObserver only reacts to node additions/removals (never attribute churn), its scan is
  debounced to 90ms, and each element is unobserved the moment it settles. Post-hydration the tree
  is mostly static; the search overlay, toasts, and cart sheet are the only frequent mutators, and
  each costs one sub-millisecond scan. Replacing it with per-component observers would add listeners
  faster than this one removes itself.
- **`instrumentation.ts` drain sweep** is the server equivalent of "realtime": a 10s-ish interval
  that replays POS delivery events. It is a single timer per process, exists to repair delivery
  state when webhooks are dropped, and must outlive any request. Keep.

---

## 4. Phase 10 — realtime/subscription duplication verdict

**There is no Supabase or realtime surface in this codebase**, so the canonical Phase 10 targets
(duplicated subscriptions, subscribe-on-every-render, missing unsubscribe) do not exist to fix.

The *real* continuous instruments were audited on the same criteria:

| Continuous instrument | Duplicated? | Recreated per render? | Unsubscribed/stopped? |
|---|---|---|---|
| Order polling (customer) | No — one `useOrderPoll` per mounted screen (orders list, tracking) | No — stable refs for load/onData; effect only restarts on interval/live/visibility (Phase 7) | Yes — stops on hidden tab and on terminal order (Phase 7) |
| Courier rAF animation | No — one loop per `CourierMap` | No | Yes — stops on arrival/hidden/delivered (Phase 2) |
| Visibility listener | No — de-duplicated this phase | No | Yes |
| POS delivery sweep (server) | No — one timer per process | No | N/A — process-scoped by design |
| Payment session poll (server) | No — one loop per request | No | Yes — request-scoped |

The "subscribe again on rerender" failure mode was real, but it lived in the **Providers**: the
profile was republished wholesale on every single write (each render could rebind every consumer),
and the location value rebroadcast a flipping picker boolean. Both were split into per-slice
contexts in Phase 8, so a profile write now notifies only the readers of the changed slice.

---

## 5. What changed in code

```
src/components/tracking-view.tsx
```
Removed the local `useDocumentVisible()` (its own `visibilitychange` listener + `useState`
snapshot) and imported the shared hook from `lib/order-access`, which the poller on the same
screen already used. The tracking screen now registers **one** visibility listener instead of two equivalent ones,
and both the courier loop and the poller stay in lockstep on the same visibility state.

Everything else in the sweep was found already lifecycle-correct; the fixes that made it so (Phases
2, 3, 7) are recorded in their own phases.