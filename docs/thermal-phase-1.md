# Thermal Optimization — Phase 1 Baseline

**Status:** baseline capture. No application logic changes permitted in this phase.
**Baseline commit:** `18ce2de` — *Split POS passkey from owner key and gate ordering on a live POS*
**Rules for this phase:** freeze the build, record numbers, change nothing.

---

## 1. Why this phase exists

Phase 1 succeeds when we can name *which* surface drives the heat, before touching a single
visual. Chasing the wrong component is the main failure mode, so the matrix in §4 is designed to
falsify a hypothesis, not to confirm one.

---

## 2. Static audit (completed, no device required)

This is the code-side prior we walk into the device tests with. Ranked by expected idle cost.

### S1 — `Ambient` aurora blobs — **suspected dominant**

| | |
|---|---|
| Mounted at | `src/app/layout.tsx:35` — **root layout, so every route** |
| Elements | `src/components/ambient.tsx:9-21`, four divs, 500–720px each |
| Mechanism | `animate-morph animate-aurora` on the same element, plus `blur-3xl` (64px) and `mix-blend-screen` |

`@keyframes morph` (`src/app/globals.css:177-181`) animates **`border-radius`**. This is not a
compositable property. Every frame the element must be fully repainted, and because that same
element also carries `blur-3xl`, each repaint re-runs a 64px Gaussian blur over a ~720×560 surface
and then re-composites it in screen blend mode.

Four of them, `animation-duration` 21s–37s, never stop. `animate-aurora` (transform) is
compositable in isolation, but it is on the same element, so the `border-radius` repaint forces the
transform to re-rasterize as well.

**The critical property:** browsers do not pause CSS animations on a visible, non-interacted page.
Only `prefers-reduced-motion` or a backgrounded tab throttles them. The idle test — open, do not
touch, keep the screen on — is precisely the worst case for this component.

### S2 — `EmberField` canvas

| | |
|---|---|
| Mounted at | `src/components/app-shell.tsx:25` — **every route under the shell** |
| Implementation | `src/components/ember-field.tsx:89-116` |

Full-viewport canvas at `devicePixelRatio` up to 2. Each frame: `clearRect` over the whole canvas,
then up to 66 `drawImage` calls under `globalCompositeOperation = "lighter"`, composited with
`mix-blend-screen` and `opacity-80`. Ember count scales with viewport area
(`ember-field.tsx:85`, `density = 27000`), so it is worst on iPad — 52 embers against 12 on a
390×844 phone.

It correctly pauses on `visibilitychange` (`ember-field.tsx:118-121`) and skips entirely under
reduced motion (`ember-field.tsx:30`). It does **not** pause on visible-idle, which is the case we
are measuring.

### S3 — sticky `backdrop-blur` over animated layers

| Location | Strength |
|---|---|
| `src/components/site-header.tsx:58` | `backdrop-blur-2xl` (sticky, every route) |
| `src/components/menu-browser.tsx:99` | `backdrop-blur-xl` (sticky) |
| `src/components/browse-filters.tsx:46` | `backdrop-blur-xl` (sticky) |

Backdrop-filter resamples everything painted behind it. S1 and S2 animate behind these, so the
backdrop is never static and the blur is recomputed per frame instead of being cached. This is
**compounding, not additive** — fixing S1/S2 should recover most of this too, which is why it is
ranked third and should not be optimized first.

### S4 — tracking rAF loop that never terminates

`src/components/tracking-view.tsx:522-555`.

Line 551 reschedules `requestAnimationFrame(tick)` unconditionally, even once the rider has settled
and the frame is a no-op. The loop therefore keeps the compositor awake indefinitely with no visual
change. While the rider *is* moving it also calls `setRider` and `setTrail([...])` every frame
(`tracking-view.tsx:543-544`), re-rendering all 716 lines of the component including the map SVG.

Only affects the tracking route. Low ceiling, but it is a real idle defect.

### S5 — polling continues while hidden

| Location | Interval |
|---|---|
| `src/app/orders/page.tsx:44` | 6000ms |
| `src/components/tracking-view.tsx:59` | 4000ms |

Neither checks `document.hidden`. A backgrounded tab keeps firing fetches, which wakes the radio.
Contributes to total energy, not to the idle-visible-screen reading. Fix is nearly free — do it in
a later phase, but do it.

### S6 — `.grain` overlay

`src/app/globals.css:418-421`. An SVG `feTurbulence` filter as a data-URI background, fixed at
`inset-0`. Static, so not a frame-rate cost, but it rasterizes a full-viewport filtered surface and
holds a composited layer. Memory, not heat.

---

## 2b. Second audit pass — CPU-side and load-side suspects

Added after the first pass. These were flagged but not examined; the first pass was biased toward
GPU/compositing cost because that is where the mechanism was most obvious. Ranking against S1–S6
requires the measurement, so they are listed here separately rather than merged.

### S7 — `Scramble` on Home: a recurring idle CPU spike

`src/components/home-hero.tsx:90` → `src/components/motion-primitives.tsx:401-443`.

A `setInterval` fires every 3200ms. Each tick runs an effect that schedules **17 `setTimeout`
callbacks** (`motion-primitives.tsx:425-438`) spread over 620ms. Each one rebuilds the string
character by character with `Math.random()` and calls `setDisplay`, so the hero re-renders ~17 times
per cycle — roughly 5 React updates per second, forever, on an otherwise static screen.

Two things make this the most likely thing to be **missed** by the matrix:

- It is *periodic*, not continuous. Sampling FPS at minutes 2 and 5 may or may not land inside a
  620ms scramble window. An average FPS figure will hide it entirely.
- It never checks `document.hidden`, so it keeps firing in a background tab as well.

This is the strongest candidate for "Home feels worse than the other routes" and the weakest
candidate for a static reading of the code. Watch the FPS meter continuously on `/` rather than
spot-checking it.

### S8 — `priority` on the first four restaurant cards

`src/app/restaurants/page.tsx:80` — `priority={i < 4}`. `priority` disables lazy-loading and emits a
preload link. Four images are fetched and decoded eagerly at `sizes="(max-width: 768px) 70vw, …"`
(`restaurant-card.tsx:64`), which on a dpr-3 phone is a large decode, on the browse route.

Honest framing: this is a **load transient**, not sustained cost. It affects roughly the first few
seconds, so a 10-minute *idle* window will not show it. Measure it by loading `/restaurants` and
watching the first 5 seconds and the scroll immediately after, not the idle tail.

### S9 — three simultaneous animations per card on hover

`restaurant-card.tsx:68` (900ms transform `scale-[1.08]`), `:71` (gradient opacity), `:73-76` (sheen
sweep). Hover fires all three at once, on every card in a grid.

Touch devices do not fire `:hover`, so this is a **desktop-control** finding. That cuts both ways:
the desktop control may look perfectly idle and tell you nothing, or it may be the only cell that
misbehaves. Either way the control is not a neutral reference, and Phase 2 should not read a clean
desktop result as "nothing to do".

### Verified and dismissed

`BLUR_DATA` (`src/components/atoms.tsx:5-6`) is an 8×8 PNG data URI, ~120 bytes, shared by every
`placeholder="blur"` in the app. Upscaling it to a card costs nothing measurable. Not a suspect —
recorded here so Phase 2 does not re-open it.

---

**If S1 dominates, all five routes will heat roughly equally.** No route owns the problem, because
the cause is in the root layout and runs everywhere.

That result is easy to misread as "no route is responsible", which would send Phase 2 hunting in the
wrong place. The matrix below is therefore built to separate *ambient global* from *route-specific*.

The lever for doing that without changing code is the OS accessibility setting:

> **Reduce Motion** (iOS: Settings → Accessibility → Motion → Reduce Motion;
> Android: Settings → Accessibility → Remove animations)

Under it, `ember-field.tsx:30` returns before starting the canvas, `scroll-progress.tsx:10` never
binds its scroll listener, and `globals.css:426-434` clamps every `animation-duration` to
`0.01ms`. The aurora blobs effectively stop animating.

This is a zero-code A/B switch that disables exactly S1 and S2. Treat it as the primary
Phase 1 experiment.

**Known limit:** Reduce Motion is coarse. It also kills useful transitions (sheet-up, pop-in,
ripple). A large drop confirms "animation is a major cost" but does **not** isolate S1 from S2 from
ordinary UI transitions. Isolating those individually needs a code change, which this phase forbids.

---

## 4. Test matrix

### Build freeze — do this first

Measure a production build. `next dev` is unusable for this: `reactStrictMode` defaults to `true`
(`next.config.ts` does not set it), so effects double-invoke and the ember canvas rAF loop
double-mounts. Dev bundles are also unminified with HMR and overlay work running. A `next dev`
baseline is not a baseline.

```bash
git rev-parse HEAD                  # must print 18ce2de
npm ci
npm run build
npm run start -- -H 0.0.0.0 -p 3000
```

`0.0.0.0` is required so the phones can reach it over the LAN — browse to `http://<LAN-IP>:3000`,
not `localhost`. Confirm all four devices load the *same* build hash before recording anything.

### Fixed controls

Hold these constant across every cell. Any drift makes the matrix incomparable.

| Control | Setting |
|---|---|
| Build | `18ce2de`, production build, LAN, no redeploy mid-matrix |
| Battery | Start each cell at 100%, or at the same level for all cells |
| Brightness | Fixed, same value for all cells, auto-brightness off |
| Network | Same Wi-Fi for all devices; record any other radio activity |
| Ambient | No other apps open, no messaging, screen brightness auto-off disabled |
| Screen | Keep awake for the whole idle window — see note below |
| Ambient temp | Same room, same session if possible |
| Airplane mode | Off; record carrier signal strength as noise |

**On "keep the screen on":** this is correct for what we are measuring. We are isolating *rendering*
heat, not sleep-state heat. A display that sleeps also stops rendering, which would hide exactly the
defect in S1. Disable auto-lock for the idle window and restore it afterward.

### Measurable signals

A browser exposes no temperature API. These are the real proxies, best first:

1. **Frame rate floor / dropped frames** — objective, fine-grained, and the closest thing to a direct
   thermal driver, since heat here is mostly sustained raster work.
   - iPhone / iPad: Mac + cable, Safari → Develop → *Show Web Inspector* → Timelines → Rendering → FPS meter.
   - Android: `chrome://inspect` → Performance panel, FPS meter.
   - Desktop Chrome: DevTools → Rendering panel.
   Record the **minimum** FPS over the window, not the average. Average hides the stutter.
2. **Battery % delta over the fixed 10-minute window** — objective, coarse. Start and end at
   identical screen state.
3. **Per-app energy rating** — retrospective, but a real OS judgement.
   - iOS: Settings → Battery → scroll to the browser → Heavy/Light.
   - Android: Settings → Battery → App battery usage.
4. **Device temperature by touch** — subjective and the least reliable. Use only to confirm that
   (1)–(3) agree. Do not record this alone.

### Cells

Four devices × five routes × two windows = **40 cells**. Each window 10 minutes.

| Route | URL path | Notes |
|---|---|---|
| Home | `/` | |
| Browse / menu | `/restaurants` | The menu browser. Distinct page from restaurant detail. |
| Restaurant detail | `/restaurants/<slug>` | |
| Orders | `/orders` | |
| Profile | `/profile` | |
| Tracking | `/order/<code>/track` | **Setup required — see below.** |

Devices: iPhone, iPad, Android phone, desktop Chrome (control).

Three corrections to the original draft, all verified against `src/app` — they would otherwise have
cost a full round of testing:

1. **There is no `/search` route.** Search is a client overlay (`src/components/search-overlay.tsx`),
   launched from a page rather than navigated to. It cannot be measured as an independent 10-minute
   idle route, because it inherits whatever route is mounted underneath it — ambient and ember
   included. Test it as part of the interaction window only. If search turns out hot on its own,
   the cause is inside the overlay's own DOM, not in a route.

2. **Tracking is `/order/[code]/track`.** Bare `/order/[code]` has no page — only `/success` and
   `/track` exist under it.

3. **Tracking needs a token issued at checkout in that same browser.** `src/app/order/[code]/track/page.tsx:9-11`
   states the order is not read server-side; the client wrapper resolves the token from storage and
   calls the authenticated API. So a real order must be placed **on each device** before its
   tracking cell, and the code differs per device. Do this once up front, before the matrix, and
   leave the tabs open.

The desktop control is not a formality. If desktop Chrome also pins the FPS meter, the cause is not
device-specific and the problem is cheaper to fix than a device-specific workaround would suggest.

**Window A — idle.** Load the route, then do nothing. No scroll, no taps, screen on. Sample FPS at
minutes 2, 5 and 10; record battery at 0 and 10.

> On `/`, do not spot-check the FPS meter — **watch it continuously**. S7 is periodic, and two
> spot samples taken 3 minutes apart can both land in the same quiet gap between scrambles.

**Window B — interaction.** Same 10 minutes, cycling: scroll → search → open restaurant → open menu
→ back → orders. Record whether scrolling stays smooth *afterwards* — deferred jank points at
S3 (backdrop-blur recomputing), not at S1.

### Order of execution

Run the **Reduce Motion A/B first**, on iPhone and Android only, before the full 40 cells. It is the
highest-information test in the phase and it may collapse the matrix:

- **Large drop with Reduce Motion on** → S1/S2 confirmed as dominant, all routes will look alike, and
  Phase 2 should start by fixing the ambient layer rather than hunting per route. Run the full
  matrix anyway, for the record.
- **Small drop** → the cause is route-specific or CPU-side, not the ambient animation. Then the full
  per-route matrix is essential, and S4/S5 deserve attention.

### Recording sheet

Copy per device. One row per cell.

| Route | Window | Reduce Motion | FPS min @2/5/10 | Battery Δ | After-scroll feel | Notes |
|---|---|---|---|---|---|---|
| / | idle | off | | | n/a | |
| / | idle | on | | | n/a | |
| /restaurants | idle | off | | | n/a | |
| /restaurants/<slug> | idle | off | | | n/a | |
| /orders | idle | off | | | n/a | |
| /profile | idle | off | | | n/a | |
| /order/<code>/track | idle | off | | | n/a | |
| … then one interaction row per route … | | | | | | |

Run each cell **twice**. A single 10-minute window on a single phone is noisy enough that a 1–2%
battery difference is not a signal.

---

## 5. Decision rules — what routes Phase 2

| Finding | Phase 2 entry point |
|---|---|
| Reduce Motion causes a large drop; routes heat uniformly | Fix S1: retire `border-radius` morphing on blurred, blended layers. Cheapest high-value change in the codebase. |
| `/` is the hot route but Reduce Motion barely helps | Fix S7 — the scramble timer, not the ambient layer. Reduce Motion already bypasses S7 (`motion-primitives.tsx:417`), so a null result on that A/B is itself the signal. |
| Idle heat tracks the route with the heaviest `backdrop-blur` | Fix S3. Note this may resolve itself once S1 lands — re-measure before acting. |
| Only Tracking heats at idle | Fix S4: terminate the rAF loop when the rider settles. |
| Heat persists with Reduce Motion on, on-device only | Look at CPU-side work: S5 polling, S7, and image decode/size on the restaurant grid (S8). |
| Desktop control is also hot | S9 is the likely cause — hover fires three animations per card. Not a mobile problem. |
| Desktop control is *clean* while phones heat | Expected. Do not read a clean control as "nothing to do"; S9 does not fire on touch. |

---

## 6. Definition of done

- [ ] Production build from `18ce2de` serving on LAN, hash confirmed identical across all 4 devices
- [ ] An order placed on each of the 3 mobile devices, tracking tab left open
- [ ] Reduce Motion A/B recorded on iPhone and Android
- [ ] 6 idle routes + 6 interaction rows, per device, each run twice
- [ ] Desktop control recorded
- [ ] One sentence written: *"<route or global> is the dominant thermal driver, because <evidence>"*
- [ ] No application code modified

If that sentence ends up being "the global ambient layer", the matrix did its job and Phase 2 starts
at `src/components/ambient.tsx`.
