# Phase 15 — Final acceptance criteria

The gate for the whole thermal program. Three classes of evidence:

- **verified** — checked here, against the working tree and the automated runs
  (invariant guard, `tsc`/ESLint/build, Phase 13 smoke dataset).
- **device-lab** — cannot be produced from a desktop CLI; the Phase 13 matrix
  and Phase 14 test protocol produce them on hardware.
- **review** — a deliberate, documented delta the owner must sign off on.

## 1. Invariant guard

`node scripts/verify/invariants.mjs` compares the working tree against HEAD
(18ce2de) and fails if any server-semantics path changed:

```
  MONITORED  src/app/api/integrations/payments/webhook/route.ts
             Phase 11 memory-leak fix: the ip->window Map entry is deleted when its
             window empties. Same window/max/first-request semantics, no signature
             or confirmation logic touched.
OK: no forbidden domain file touched by the thermal work.
```

Guarded paths: `src/db/`, `src/integrations/`, `src/app/api/orders/`,
`src/app/api/integration/`, `src/app/api/integrations/`, `src/app/api/partner/`,
`src/lib/{order-token,webhook-crypto,domain,cart,razorpay-checkout,ordering-gate,pos-order-status-webhook,pos-bridge}.{ts,tsx}`.

Every other working-tree change is presentation or client-render code
(components, `performance-mode`, `experiments`, CSS, `scripts/`, `docs/`), each
attributable to a specific phase in this program.

## 2. Acceptance criteria matrix

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | **Thermal** — no abnormal heat during idle browsing | No unbounded loop possible any more: pollers stop when hidden/terminal (`order-access.ts`), ember RAF stops on hidden (`ember-field.tsx`), reduced-motion kills ember+ambient+hero, ambient tiers are CSS budgets. `reqMin` 0 on every idle smoke run. | **device-lab** (Phase 14 T1–T4 temp trace) |
| 2 | **Battery** — materially reduced drain | Phase 7/8 audit removed per-instance listeners; Phase 11 removed the one growing Map; Phase 12 collapses 3+ device listeners into one shared pair. Smoke: listener/node deltas 0, long tasks ~0 at idle after settle. | **device-lab** (Phase 13 battery column, T8–T10) |
| 3 | **Responsiveness** — smooth scrolling/navigation | Smoke under CPU /4 + iPhone-14 profile: home idle 57–60 fps, orders 59.6, restaurant 38.4 (decode-bound), overlay 19.4 (backdrop-blur). Scroll/RAF paths release every frame; no >50 ms task at idle. | verified (FPS) + **device-lab** (T4/T5 felt-smooth) |
| 4 | **Visual quality** — premium appearance intact | Full mode is untouched: same ember desktop budget (66/60fps/blend) and showing, same ambient CSS tiers, `home-hero` glow dedupes to the identical layer, motion primitives unchanged in full, reduced-motion gating pre-existing. The low modes keep the exact pre-existing CSS treatments and layer sets. | verified (code) + **device-lab** (screenshot diff A/B) |
| 5 | **Ordering** — no change to cart / checkout / creation / status / restaurant integration | `src/lib/cart.tsx` untouched; `checkout/page.tsx` diff is Profile context-subslicing only; all order mutations/DB/status/route handlers untouched (guard). | verified |
| 6 | **Tracking** — no change to courier position / tracking API / status / lifecycle | POS/courier/db layers untouched (guard). `tracking-view.tsx` diff is a polling/visibility refactor onto the shared hook with the same cadence and the same visibility lifecycle. | verified |
| 7 | **Payments** — no change to flow / UPI / cash / confirmation | `razorpay-checkout.ts`, `pay/start`, `pay/verify`, refund/reconcile untouched. Only the `webhook/route.ts` Map-prune (monitored, memory-only; window, max-per-window and signature checks identical). | verified |
| 8 | **Desktop** — visual quality essentially unchanged | No layout/DOM/CSS change in `full`; ambient/ember same CSS and budgets. | verified |
| 9 | **Build & type hygiene** | `tsc --noEmit`, targeted ESLint, `npm run build` exit 0 after every phase. | verified |

## 3. Flagged deltas (owner sign-off)

These are the only behaviour–visible differences the whole program intentionally
produced:

1. **Orders list "live" predicate** (Phase 7): the page now uses
   `isOrderLive()` (`order-public.ts`), so `delivered`, `cancelled` and
   `rejected` orders no longer render as "live"/ongoing. This was a bug fix
   (they were previously mislabelled), inside the presentation layer only.
2. **Weak-desktop tier** (Phase 12): desktops with ≤4 cores are now classified
   `balanced`, so their ember field runs at 30 fps instead of 60. No visual or
   DOM change — a frame-budget choice for that subset. Reversible by flipping
   the threshold in `performance-mode.ts`.
3. **Polling cadence** (Phase 7): orders page polls every 6 s, tracking every
   4 s (the pre-existing cadences were preserved; the change is that both now
   share one `useOrderPoll` and stop cleanly when hidden or terminal).
4. **Reduced motion now also demotes fine-pointer savers** (Phase 12): a
   fine-pointer device with `save-data` preference now gets `low` (ember 16
   particles, no blend) rather than `full`. Same conservative direction as the
   rest of the program.

The program's only in-`src/` changes are presentation, polling, memory
hygiene and mode selection; none of the ordering, tracking, payment, cart or
checkout semantics changed.

## 4. Remaining to pass

- Full Phase 13 matrix (0/2/5/10 min x 5 routes) on the device lab, merged
  with the `results.jsonl` table.
- Phase 14 tests 1–10, especially T1–T4 (heat/battery/fps), T5 (felt
  smoothness), T6 (lock/unlock), T7 (background wakeup zero), T8/T9 net.
- Owner sign-off on the four flagged deltas above.