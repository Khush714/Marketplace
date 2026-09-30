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
 *     [--cpu 4] [--device iPhone 14] [--spawn-port 3003] \
 *     [--hidden]
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

if (!EXPERIMENTS[experiment]) {
  console.error(`unknown experiment "${experiment}" (expected ${Object.keys(EXPERIMENTS).join("|")})`);
  process.exit(2);
}

const probeScript = `
  (() => {
    window.__prof = { longTasks: [], notes: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__prof.longTasks.push({ start: e.startTime, dur: e.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch (e) { window.__prof.notes.push("no longtask observer"); }
  })();
`;

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

async function waitForServer(url, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function resolveRoute(page, route) {
  if (route === "search") {
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
    return { ok: true };
  }
  if (route === "restaurant") {
    const res = await fetch(`${base}/api/restaurants?loc=old-city`);
    const json = await res.json();
    const first = json?.restaurants?.[0];
    if (!first?.slug) return { ok: false, note: "no restaurant payload (API shape changed?)" };
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

async function measureOnce(browser, overrides) {
  const dev = devices[deviceName];
  if (!dev) throw new Error(`unknown device "${deviceName}"`);
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
  if (route === "home") {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    routeOk = { ok: true };
  } else if (route === "orders") {
    await page.goto(`${base}/orders`, { waitUntil: "networkidle" });
    routeOk = { ok: true };
  } else {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    routeOk = await resolveRoute(page, route);
  }

  const routeMs = Date.now() - t0route;
  if (!routeOk.ok) {
    await context.close();
    return { skipped: true, note: routeOk.note };
  }

  await page.waitForTimeout(2000); // settle post-hydration, then start the window

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

  page.off("request", onRequest);
  page.off("response", onResponse);
  await context.close();

  const row = {
    source: "automated",
    device: deviceName,
    cpuThrottle,
    hidden,
    route,
    experiment,
    label: Object.keys(overrides).length ? `no-${Object.keys(overrides).join("-no-")}` : experiment,
    routeLoadMs: routeMs,
    windowMs: durMs,
    fps,
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
    if (!(await waitForServer(`${proxiedBase}/api/health`))) {
      console.error("server did not come up in time");
      child.kill();
      process.exit(1);
    }
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const row = await measureOnce(browser, EXPERIMENTS[experiment]);
    await browser.close();
    console.log(JSON.stringify(row, null, 2));
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