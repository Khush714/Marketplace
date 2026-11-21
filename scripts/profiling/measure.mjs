/**
 * Runtime profiling harness — Phases 13 & 14.
 *
 * Measures what a real browser can expose about each route and each
 * Test A..E configuration, then records one JSON row per run into a
 * results file. Battery/temperature and on-device CPU cannot be read from a
 * desktop browser; those rows are collected by hand on the device lab (see
 * README.md) and merged into the same file as `source: "lab"`.
 *
 * Usage:
 *   node scripts/profiling/measure.mjs \
 *     [--route home|search|restaurant|orders|tracking] \
 *     [--experiment base|A|B|C|D|E] \
 *     [--dur-ms 120000] \
 *     [--base http://localhost:3003] \
 *     [--cpu 4] [--device "iPhone 14"|desktop] [--spawn-port 3003] \
 *     [--routes home,orders,restaurant,tracking] [--runs 3] \
 *     [--hidden]
 *
 * `--routes`/`--runs` batch the matrix against a single server; without them a
 * single route is measured once. Run 1 of each route pays the cold image
 * optimiser cost and is reported separately from the median.
 *
 * Two distinct things are measured, and they are not interchangeable:
 *
 *   The `load` block  — TTFB, FCP, LCP, CLS, and `transferSize` totals per
 *     resource type. Read once navigation resolves, so it measures the page.
 *
 *   The idle window    — `reqMin` / `requestBytes` / heap / DOM counters.
 *     These start counting only after the load has finished, which is why
 *     `requestBytes: 0` is the expected healthy result, not a broken counter.
 *
 * `--device desktop` with `--cpu 1` is the unthrottled desktop pass; the
 * default `--cpu 4` iPhone profile is the throttled mobile pass.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";

const ROOT = path.resolve(process.cwd());
const DEFAULT_BASE = "http://localhost:3003";
const DEFAULT_OUT = path.join("scripts", "profiling", "results.jsonl");

const EXPERIMENTS = {
  base: {},
  A: {},
  B: { ember: "off" },
  C: { ambient: "off" },
  D: { ember: "off", ambient: "off" },
  E: { polling: "off" },
};

function parseArg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function hasFlag(name) {
  return process.argv.includes(name);
}

const route = parseArg("--route", "home");
const experiment = parseArg("--experiment", "base");
const durMs = Number(parseArg("--dur-ms", "120000"));
const base = parseArg("--base", DEFAULT_BASE);
const outFile = parseArg("--out", DEFAULT_OUT);
const cpuRate = Number(parseArg("--cpu", "4"));
const deviceName = parseArg("--device", "iPhone 14");
const spawnPort = parseArg("--spawn-port", "");
const runs = Math.max(1, Number(parseArg("--runs", "1")));
const routes = parseArg("--routes", route)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!EXPERIMENTS[experiment]) {
  console.error(`unknown experiment "${experiment}" (expected ${Object.keys(EXPERIMENTS).join("|")})`);
  process.exit(2);
}

/* Load-timing probe.

   Everything here is a `buffered: true` observer registered from an init
   script, which means it is installed before the document's first byte of
   script runs and replays whatever already happened. That is the only way to
   see FCP/LCP: registering a plain observer after `page.goto()` returns is
   always too late, because by then the entries have been emitted.

   Entries are buffered per document, so a route that arrives via a real
   navigation (`page.goto`) starts from an empty set. Note that `search` does
   NOT navigate — it opens an overlay over `/` — so its load block describes
   the homepage document, which is why it also carries a separate `dialogMs`.

   Byte accounting uses `transferSize`, which is the compressed wire size
   including headers, i.e. what actually crosses the network. `encodedBodySize`
   and `decodedBodySize` are recorded alongside it for diagnosis but are not
   summed: summing the decoded sizes would report how much *text* the browser
   parsed rather than how much the user waited for.

   Cross-origin subresources report `transferSize === 0` unless the origin
   sends `Timing-Allow-Origin`. Google Fonts does not, so font bytes are
   reported as unavailable rather than silently counted as zero cost — which
   is also one of the reasons `next/font` (same-origin) is worth measuring. */
const probeScript = `
  (() => {
    window.__prof = { longTasks: [], notes: [], shifts: [], lcp: [], paints: [], resources: [], inputSeen: false };
    var P = window.__prof;
    var obs = function (type, cb) {
      try {
        new PerformanceObserver(function (list) {
          for (var i = 0; i < list.getEntries().length; i++) cb(list.getEntries()[i]);
        }).observe({ type: type, buffered: true });
      } catch (e) { P.notes.push("no " + type + " observer"); }
    };
    obs("longtask", function (e) { P.longTasks.push({ start: e.startTime, dur: e.duration }); });
    obs("paint", function (e) { P.paints.push({ name: e.name, start: e.startTime }); });
    obs("largest-contentful-paint", function (e) {
      var el = e.element;
      P.lcp.push({
        start: e.startTime,
        size: e.size,
        tag: el && el.tagName ? el.tagName : "",
        id: el && el.id ? el.id : "",
      });
    });
    obs("layout-shift", function (e) { if (!e.hadRecentInput) P.shifts.push({ start: e.startTime, value: e.value }); });
    obs("resource", function (e) {
      P.resources.push({
        name: e.name,
        type: e.initiatorType,
        start: e.startTime,
        dur: e.duration,
        transfer: e.transferSize,
        encoded: e.encodedBodySize,
        decoded: e.decodedBodySize,
      });
    });
    // LCP stops emitting after the first real interaction, so the final
    // buffered entry is the final value. Input is tracked to prove no
    // interaction happened during the measured window; if it did, the LCP
    // figure would be a lower bound and the row is not comparable.
    ["keydown", "pointerdown", "touchstart", "click"].forEach(function (t) {
      window.addEventListener(t, function () { P.inputSeen = true; }, { capture: true, passive: true });
    });
  })();
`;

/* Read the load block. Called once immediately after navigation resolves so
   that byte totals describe the page itself rather than the idle window: the
   base experiment polls, and anything requested after load would otherwise be
   folded into a number labelled "page weight". */
function collectLoad(page) {
  return page.evaluate(() => {
    const P = window.__prof || { paints: [], lcp: [], shifts: [], resources: [] };
    const nav = performance.getEntriesByType("navigation")[0] || null;

    const paints = {};
    for (const p of P.paints) if (paints[p.name] === undefined) paints[p.name] = p.start;

    const byType = {};
    const top = [];
    let totalBytes = 0;
    let unavailable = 0;
    for (const r of P.resources) {
      const bytes = r.transfer || 0;
      if (!bytes) unavailable += 1;
      totalBytes += bytes;
      byType[r.type] = (byType[r.type] || 0) + bytes;
      top.push({ name: r.name, type: r.type, bytes, dur: Math.round(r.dur) });
    }
    top.sort((a, b) => b.bytes - a.bytes);

    const r1 = (n) => (n === undefined ? null : Math.round(n));
    return {
      // Lighthouse defines TTFB as responseStart minus navigation start, which
      // folds in DNS + TCP + TLS. serverWaitMs is responseStart minus
      // requestStart, i.e. time actually spent waiting on the server, so a slow
      // TTFB can be attributed to connection setup or to render.
      ttfbMs: nav ? r1(nav.responseStart) : null,
      serverWaitMs: nav ? r1(nav.responseStart - nav.requestStart) : null,
      connectMs: nav && nav.connectEnd ? r1(nav.connectEnd - nav.connectStart || nav.responseStart) : null,
      protocol: nav ? nav.nextHopProtocol || null : null,
      transferSize: nav ? nav.transferSize || 0 : 0,
      fcpMs: r1(paints["first-contentful-paint"]),
      fpMs: r1(paints["first-paint"]),
      domContentLoadedMs: nav ? r1(nav.domContentLoadedEventEnd) : null,
      loadEventEndMs: nav ? r1(nav.loadEventEnd) : null,
      resourceCount: P.resources.length,
      totalBytes,
      bytesUnavailable: unavailable,
      byType,
      topResources: top.slice(0, 8),
      cls: Math.round(P.shifts.reduce((a, s) => a + s.value, 0) * 10000) / 10000,
      lcpMs: (() => {
        const l = P.lcp[P.lcp.length - 1];
        return l ? { ms: Math.round(l.start), tag: l.tag, id: l.id, size: l.size } : null;
      })(),
      inputSeen: !!P.inputSeen,
    };
  });
}

/* Fixed desktop profile. `devices[...]` only describes phones and tablets, and
   the harness throws on an unknown name, so an unthrottled desktop run needs
   its own descriptor rather than a device entry. Paired with `--cpu 1`, which
   is CDP's "no throttling" rate. */
const DESKTOP_PROFILE = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

function measureFps() {
  return new Promise((resolve) => {
    const gaps = [];
    let last = performance.now();
    const step = (t) => {
      gaps.push(t - last);
      last = t;
      if (gaps.length < 121) requestAnimationFrame(step);
      else {
        const fps = 1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);
        resolve(Math.round(fps * 10) / 10);
      }
    };
    requestAnimationFrame(step);
  });
}

/* Horizontal-overflow probe.
   `scrollWidth > clientWidth` means the document is wider than the viewport,
   which on a phone does not merely allow panning — it inflates the layout
   viewport, so `window.innerWidth` reports the inflated number and every
   `position: fixed; inset-0` decoration on the route then resizes itself to
   it. That is self-sustaining, and it is how a 60px decorative overshoot on
   the home hero became a whole-route sideways pan.

   The tolerance is 1px because fractional layout widths round; beyond that it
   is real. Culprits are attributed to a selector so a failure names its own
   cause. Elements inside a legitimate scroller (`overflow-x: auto/scroll`, and
   the rails) are excluded — they are meant to exceed the viewport.

   `position: fixed` elements are excluded from attribution too, and that is
   not a shortcut. Fixed elements are laid out against the viewport and never
   contribute to the document's scrollable overflow, so they cannot be the
   cause of any of this; they only *look* guilty because once the document
   widens, `inset-0` decorations stretch to match and show up at exactly the
   overflow width. Ranking them alongside real culprits buried the actual
   offender: an injected 5000px canary lost the top-five slots to four fixed
   layers that had merely resized. Candidates are ranked by how far they
   actually stick out, so the widest in-flow element is named first.

   The backstop is `overflow-x: clip` on both `html` and `body` (see
   globals.css). This probe exists because clipping alone would hide the
   symptom while leaving the content unreachable and mis-sized. */
function probeOverflow() {
  const de = document.documentElement;
  const over = de.scrollWidth - de.clientWidth;
  if (over <= 1) return { overflowPx: 0, culprits: [] };
  const vw = de.clientWidth;
  const isClipped = (el) => {
    let p = el.parentElement;
    while (p && p !== de && p !== document.body) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true;
      p = p.parentElement;
    }
    return false;
  };
  const found = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    const sticksOut = Math.max(b.right - vw, -b.left);
    if (sticksOut <= 1 || isClipped(el)) continue;
    if (getComputedStyle(el).position === "fixed") continue;
    const key = el.tagName.toLowerCase() + "." + String(el.className || "").trim().split(/\s+/).slice(0, 3).join(".");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ key, sticksOut: Math.round(sticksOut) });
  }
  found.sort((a, b) => b.sticksOut - a.sticksOut);
  return { overflowPx: over, culprits: found.slice(0, 5).map((f) => `${f.key} (+${f.sticksOut}px)`) };
}

/* Polls for the worst overflow over `ms`, because the worst state is often not
   the settled one — a skeleton row is only mounted while its fetch is in
   flight, and /profile briefly ran 438px wide for exactly that long. */
async function peakOverflow(page, ms, interval = 120) {
  const end = Date.now() + ms;
  let peak = { overflowPx: 0, culprits: [] };
  for (;;) {
    let got = { overflowPx: 0, culprits: [] };
    try {
      got = await page.evaluate(probeOverflow);
    } catch {
      break; // navigation or teardown — keep whatever we already saw
    }
    if (got.overflowPx > peak.overflowPx) peak = got;
    if (Date.now() >= end) break;
    await page.waitForTimeout(interval);
  }
  return peak;
}

async function waitForServer(url, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      /* Any HTTP response means the listener is up. Requiring `res.ok` here
         conflates "the server booted" with "the app's dependencies are
         healthy": `/api/health` queries the database, so an unreachable or
         wrong-credential database makes a perfectly booted server look like a
         failed boot, and the run dies before it records anything. Routes that
         need the database surface their own failure as a skipped row. */
      await fetch(url, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function resolveRoute(page, route) {
  if (route === "search") {
    // Time the overlay separately: this route never navigates, so the load
    // block describes the homepage document. `dialogMs` is the only figure
    // that says anything about the search route itself.
    const t0dialog = Date.now();
    // Focus the document before the shortcut. A freshly navigated page in a
    // multi-page context is not the focused one, so the keypress was delivered
    // nowhere and the run fell through to the fallback below — which then timed
    // out on every mobile profile, because that fallback clicks a trigger
    // carrying `hidden md:flex`, i.e. invisible at the very viewport this
    // harness defaults to. Result: `--route search`, one of the routes in the
    // README matrix, could not be measured at all on a phone.
    await page.locator("body").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("/");
    try {
      await page.waitForSelector("#search-dialog", { timeout: 2500 });
    } catch {
      const trigger = page.locator("button:has-text('Search restaurants')").first();
      if (await trigger.count()) {
        await trigger.click();
        try {
          await page.waitForSelector("#search-dialog", { timeout: 2500 });
        } catch {
          return { ok: false, note: "search overlay did not open" };
        }
      } else {
        return { ok: false, note: "search trigger not found" };
      }
    }
    return { ok: true, dialogMs: Date.now() - t0dialog };
  }
  if (route === "restaurant") {
    /* Resolving a slug needs the database. When it is unreachable, `fetch`
       here used to hand an empty body to `res.json()`, which threw an
       unhandled SyntaxError and took the whole batch down — taking runs that
       had already been measured with it. A dependency failure is a skipped
       row, never a crash. */
    let first;
    try {
      const res = await fetch(`${base}/api/restaurants?loc=old-city`, {
        signal: AbortSignal.timeout(15000),
      });
      const json = await res.json();
      first = json?.restaurants?.[0];
    } catch (e) {
      return { ok: false, note: `restaurants API unreachable: ${String(e.message).slice(0, 80)}` };
    }
    if (!first?.slug) return { ok: false, note: "no restaurant payload (API empty or shape changed?)" };
    await page.goto(`${base}/restaurants/${first.slug}`, { waitUntil: "networkidle" });
    return { ok: true, note: `slug=${first.slug}` };
  }
  if (route === "tracking") {
    const orders = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem("profile");
        if (!raw) return [];
        const p = JSON.parse(raw);
        const orders = Array.isArray(p.orders) ? p.orders : [];
        return orders.filter((o) => o.code && o.token).map((o) => o.code);
      } catch {
        return [];
      }
    });
    if (orders.length === 0) {
      return { ok: false, note: "no tracked order token in profile — reachable only after checkout" };
    }
    await page.goto(`${base}/order/${orders[0]}/track`, { waitUntil: "networkidle" });
    return { ok: true, note: `code=${orders[0]}` };
  }
  return { ok: true };
}

async function measureOnce(browser, overrides, opts = {}) {
  const rt = opts.route || route;
  const devName = opts.device || deviceName;
  const dev = devName === "desktop" ? DESKTOP_PROFILE : devices[devName];
  if (!dev) throw new Error(`unknown device "${devName}"`);
  const context = await browser.newContext({
    ...dev,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  await context.addInitScript(probeScript);
  await context.addInitScript((o) => { window.__PERF__ = o; }, overrides);

  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Performance.enable");
    await cdp.send("Memory.enable");
  } catch {}

  let cpuThrottle = "off";
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    cpuThrottle = String(cpuRate);
  } catch {
    cpuThrottle = "unavailable";
  }

  const sample = async () => {
    const metrics = await cdp.send("Performance.getMetrics");
    const counters = await cdp.send("Memory.getDOMCounters");
    const m = Object.fromEntries(metrics.metrics.map((x) => [x.name, x.value]));
    return {
      jsHeap: m.JSHeapUsedSize,
      task: m.TaskDuration,
      script: m.ScriptDuration,
      layout: m.LayoutDuration,
      frames: m.Frames,
      nodes: counters.nodes,
      listeners: counters.jsEventListeners,
      documents: counters.documents,
    };
  };

  let routeOk;
  const t0route = Date.now();
  if (rt === "home") {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    routeOk = { ok: true };
  } else if (rt === "orders") {
    await page.goto(`${base}/orders`, { waitUntil: "networkidle" });
    routeOk = { ok: true };
  } else {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    routeOk = await resolveRoute(page, rt);
  }

  const routeMs = Date.now() - t0route;
  if (!routeOk.ok) {
    await context.close();
    return { skipped: true, note: routeOk.note };
  }

  // Snapshot the load block here, before the settle and idle windows open, so
  // byte totals describe the page itself rather than whatever the base
  // experiment's polling added afterwards.
  //
  // `networkidle` alone is not a safe moment to read paint entries: it only
  // means the network went quiet for 500ms, and on a fast (unthrottled) load
  // that can happen before the compositor has produced its first frame, which
  // is exactly when FCP is recorded. That showed up as `fcp=null` on an
  // unthrottled desktop run that had in fact painted at ~200ms. Waiting for
  // `load` and then two animation frames guarantees the first frame has been
  // committed without opening the window that polling would contaminate.
  await page.waitForLoadState("load").catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  const loadSnap = await collectLoad(page);

  // Settle post-hydration, then start the window. Polled rather than slept, so
  // a layout that is only wrong while a fetch is in flight still registers.
  const loadOverflow = await peakOverflow(page, 2000);

  const t0 = await sample();
  let requests = 0;
  let requestBytes = 0;
  const onRequest = (r) => {
    if (r.url().startsWith(base)) requests += 1;
  };
  const onResponse = (r) => {
    if (!r.url().startsWith(base)) return;
    const cl = Number(r.headers()["content-length"] || 0);
    if (cl > 0) requestBytes += cl;
  };
  page.on("request", onRequest);
  page.on("response", onResponse);

  let hidden = false;
  if (hasFlag("--hidden")) {
    setTimeout(() => {
      cdp.send("Page.setWebLifecycleState", { state: "frozen" }).catch(() => {});
    }, 3000);
    hidden = true;
  }

  await page.waitForTimeout(durMs);
  const t1 = await sample();
  const fps = await page.evaluate(measureFps);
  const prof = await page.evaluate(() => window.__prof);

  /* Horizontal-overflow guard. Polled across the settle window as well as read
     once at the end, so a transient layout (see `peakOverflow`) is caught and
     not just the resting state. */
  const settledOverflow = await page.evaluate(probeOverflow);

  page.off("request", onRequest);
  page.off("response", onResponse);
  await context.close();

  const overflow =
    loadOverflow.overflowPx > settledOverflow.overflowPx ? loadOverflow : settledOverflow;
  const row = {
    source: "automated",
    device: devName,
    cpuThrottle,
    hidden,
    route: rt,
    experiment,
    label: Object.keys(overrides).length ? `no-${Object.keys(overrides).join("-no-")}` : experiment,
    routeLoadMs: routeMs,
    windowMs: durMs,
    dialogMs: routeOk.dialogMs ?? null,
    load: loadSnap,
    fps,
    overflowPx: overflow.overflowPx,
    overflowCulprits: overflow.culprits,
    longTaskCount: prof.longTasks.length,
    longTaskMs: Math.round(prof.longTasks.reduce((a, b) => a + b.dur, 0)),
    reqMin: Math.round((requests * 60000) / durMs),
    requestBytes: requestBytes,
    jsHeapDeltaMB: Math.round(((t1.jsHeap - t0.jsHeap) / 1048576) * 10) / 10,
    taskDeltaMs: Math.round((t1.task - t0.task) * 10) / 10,
    scriptDeltaMs: Math.round((t1.script - t0.script) * 10) / 10,
    layoutDelta: Math.round(t1.layout - t0.layout),
    framesDelta: Math.round(t1.frames - t0.frames),
    nodesDelta: t1.nodes - t0.nodes,
    listenersDelta: t1.listeners - t0.listeners,
    documentsDelta: t1.documents - t0.documents,
    notes: [...(routeOk.note ? [routeOk.note] : []), ...(prof.notes || [])],
  };
  fs.appendFileSync(outFile, JSON.stringify(row) + "\n");
  return row;
}

async function main() {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  let child = null;
  if (spawnPort) {
    child = spawn(
      "npx",
      ["--no-install", "next", "start", "-p", spawnPort],
      { cwd: ROOT, stdio: "ignore", shell: true },
    );
    const proxiedBase = `http://localhost:${spawnPort}`;
    console.log(`waiting for server on ${proxiedBase} …`);
    /* `/robots.txt` is a prerendered static route, so it answers without ever
       touching the database. `/api/health` looked like the obvious liveness
       probe but it queries Postgres, and when the database is unreachable or
       circuit-broken that request hangs rather than failing fast — which reads
       as a server that never booted. */
    if (!(await waitForServer(`${proxiedBase}/robots.txt`))) {
      console.error("server did not come up in time");
      child.kill();
      process.exit(1);
    }
  }

try {
    const browser = await chromium.launch({ headless: true });
    const rows = [];

    /* Batch mode. One server for the whole matrix rather than one per
       invocation: `next start` boot plus the first-hit image-optimizer cost
       dominate a single run, and spawning per route would charge every route
       that cold cost again. Run 1 of each route is therefore always the cold
       one, which is why medians are taken over `--runs` and run 1 is
       reported separately below. */
    for (const rt of routes) {
      for (let i = 1; i <= runs; i += 1) {
        const row = await measureOnce(browser, EXPERIMENTS[experiment], { route: rt });
        rows.push(row);
        if (row.skipped) {
          console.log(`  ${rt} run ${i}/${runs}: SKIPPED — ${row.note}`);
          continue;
        }
        const l = row.load;
        console.log(
          `  ${rt} run ${i}/${runs}: ttfb=${l.ttfbMs} fcp=${l.fcpMs} lcp=${l.lcpMs ? l.lcpMs.ms : "-"}` +
            ` cls=${l.cls} bytes=${l.totalBytes} script=${l.byType.script || 0} css=${l.byType.css || 0}` +
            ` img=${l.byType.img || 0} routeMs=${row.routeLoadMs}`,
        );

        // A row is still written for a failure, so the measurement is not lost —
        // only the exit code is withheld.
        if (row.overflowPx > 1) {
          console.error(
            `\nFAIL: horizontal overflow ${row.overflowPx}px on /${row.route} (${row.device}).` +
              (row.overflowCulprits.length ? `\n  widest: ${row.overflowCulprits.join(", ")}` : "") +
              `\n  The document is wider than the viewport, so the layout viewport inflates and the` +
              `  route can be panned sideways. Fix the element above; do not rely on the` +
              `  overflow-x: clip backstop in globals.css — it hides it, it does not fix it.`,
          );
          process.exitCode = 1;
        }
      }
    }
    await browser.close();
    if (rows.length === 1) console.log(JSON.stringify(rows[0], null, 2));
    console.log(`\nmedians of ${runs} (run 1 excluded as cold):`);
    for (const rt of routes) {
      const sel = rows.filter((r) => !r.skipped && r.route === rt).slice(1);
      if (!sel.length) {
        console.log(`  /${rt}: no warm runs`);
        continue;
      }
      const med = (f) => {
        const v = sel.map(f).filter((n) => typeof n === "number").sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : null;
      };
      const first = rows.filter((r) => !r.skipped && r.route === rt)[0];
      console.log(
        `  /${rt}: ttfb=${med((r) => r.load.ttfbMs)} fcp=${med((r) => r.load.fcpMs)}` +
          ` lcp=${med((r) => (r.load.lcpMs ? r.load.lcpMs.ms : null))} cls=${med((r) => r.load.cls)}` +
          ` bytes=${med((r) => r.load.totalBytes)}` +
          (first ? `   [cold run: fcp=${first.load.fcpMs} lcp=${first.load.lcpMs ? first.load.lcpMs.ms : "-"}]` : ""),
      );
    }
  } finally {
    if (child) {
      child.kill();
      if (process.platform === "win32") await new Promise((r) => { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]).on("exit", r); });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});