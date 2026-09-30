# Runtime profiling & thermal regression runbook (Phases 13-14)

Two tools, same dataset file:

- `measure.mjs` — automated rows, run on any machine with a real browser
  (headless Chromium here). Captures FPS, long tasks, network, JS heap and
  DOM/listener drift over a fixed idle window, per route and per test config.
- Manual lab rows — battery, temperature and on-device CPU must be read from
  the physical device (phone/iPad, mobile browser, DevTools -> Performance
  trace + `power` pane + device thermal sensor). Append them to the same JSONL
  with `"source": "lab"` so the merged file is one dataset.

## Starting the server

    # requires the production build (npm run build) and a reachable Postgres
    npx next start -p 3003

The harness can spawn it for you by passing `--spawn-port 3003`.

## Phase 13 — route matrix

For each route run the four windows. `dur-ms` is the idle window after a 2s
settle; the 0-min probe is captured by running with a short window (e.g.
`--dur-ms 3000`) after the network goes idle.

    node scripts/profiling/measure.mjs --route home       --dur-ms 120000 --cpu 4
    node scripts/profiling/measure.mjs --route search     --dur-ms 120000 --cpu 4   # opens the overlay via "/"
    node scripts/profiling/measure.mjs --route restaurant --dur-ms 120000 --cpu 4   # first seeded restaurant
    node scripts/profiling/measure.mjs --route orders     --dur-ms 120000 --cpu 4
    node scripts/profiling/measure.mjs --route tracking   --dur-ms 120000 --cpu 4   # only reaches /order/<code>/track
                                                                                     # if a tokenised order exists in profile

The matrix columns for each route x window:

| window | CPU % | FPS | JS exec (long-task ms) | rendering/compositing | network req/min | memory (heap Δ, nodes Δ) | battery/temp |
|--------|-------|-----|------------------------|-----------------------|-----------------|--------------------------|--------------|
| 0 min  | lib   | auto| auto                   | lab                   | auto            | auto                     | lab          |
| 2 min  | lab   | auto| auto                   | lab                   | auto            | auto                     | lab          |
| 5 min  | lab   | auto| auto                   | lab                   | auto            | auto                     | lab          |
| 10 min | lab   | auto| auto                   | lab                   | auto            | auto                     | lab          |

Tracking: on-device CPU measured with fi.liftoff/DevTools `power` overlay, CPU%
per tab in Canvas Profiler. Battery via device top-bar graph; temperature via
Battery Historian/`adb shell dumpsys batterystats` (Android) or the Device Lab
IR/case-probe (iOS).

## Phase 13 — Test A..E isolation

| Test | Disables          | Harness flag                  | Effect checked |
|------|-------------------|-------------------------------|----------------|
| A    | (none, current)   | `--experiment base`           | control        |
| B    | EmberField        | `--experiment B`              | `ember:"off"`  |
| C    | Ambient           | `--experiment C`              | `ambient:"off"`|
| D    | EmberField+Ambient| `--experiment D`              | both above     |
| E    | Polling           | `--experiment E`              | `polling:"off"`|

The toggle is implemented in `src/lib/experiments.ts`, read from
`window.__PERF__` (set by the harness before hydration). Production default is
everything on; nothing in the app ever sets `window.__PERF__`.

Run each test on the same route (Home is the differentiating surface:
EmberField + Ambient + pollers all live there) at 2 min, then 10 min for the
two strongest candidates.

## Phase 14 — regression tests

| # | Test                              | Method                       |
|---|-----------------------------------|------------------------------|
| 1 | Home, 10 min idle                 | `--route home --dur-ms 600000` |
| 2 | Restaurant, 10 min idle           | `--route restaurant --dur-ms 600000` |
| 3 | Orders, 10 min idle               | `--route orders --dur-ms 600000` |
| 4 | Tracking, 10 min **active**       | lab (visible steps via courier simulation) |
| 5 | Continuous navigation, 10 min     | lab or `measure.mjs` route=none loop |
| 6 | Lock/unlock                       | lab only (no CDP equivalent)   |
| 7 | Tab background -> return          | `--hidden` (freezes after 3s)  |
| 8 | Poor network                      | `--cpu 4` + lab throttling, or CDP offline 3G |
| 9 | Good network                      | no flags                       |
| 10| 30 min long session               | `--route home --dur-ms 1800000` |

PASS criteria:
- FPS: 55+ under throttle in the active phases, 60 at idle unless reduced-motion.
- JS heap: < ~8 MB drift over a 10-min idle window, no monotonic rise (bounded
  collections, no listener accumulation).
- Listeners/data `Delta` rows equal to 0 during idle windows.
- Long tasks: 0 during a clean 10-min idle (any >50 ms task on the main thread
  indicates a regression).
- Background (Test 7): request rate drops to 0 once hidden.