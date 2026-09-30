/**
 * Residual-heat diagnostic: enumerate every animation still running after
 * settle on each route, plus main-thread load over a sample window.
 *
 * Run: node scripts/profiling/animations-audit.mjs
 *      optional: --routes home,restaurant,orders,search  --window-ms 15000
 *
 * The audit lists document.getAnimations() entries (CSS + Web Animations),
 * notes the fixed canvas layers (RAF-driven, invisible to getAnimations), and
 * records long-task + FPS + task-time deltas like measure.mjs.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { chromium, devices } from "playwright";

const ROOT = path.resolve(process.cwd());
const BASE = "http://localhost:3003";
const routes = (() => {
  const i = process.argv.indexOf("--routes");
  return i !== -1 ? process.argv[i + 1].split(",") : ["home", "restaurant", "orders", "search"];
})();
const windowMs = Number(((() => {
  const i = process.argv.indexOf("--window-ms");
  return i !== -1 ? process.argv[i + 1] : "15000";
}))());

async function openRoute(page, route) {
  if (route === "search") {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.keyboard.press("/");
    try { await page.waitForSelector("#search-dialog", { timeout: 3000 }); } catch { return null; }
    return;
  }
  if (route === "restaurant") {
    const json = await (await fetch(`${BASE}/api/restaurants?loc=old-city`)).json();
    const slug = json?.restaurants?.[0]?.slug;
    if (!slug) return null;
    await page.goto(`${BASE}/restaurants/${slug}`, { waitUntil: "networkidle" });
    return;
  }
  await page.goto(`${BASE}/${route !== "home" ? route : ""}`, { waitUntil: "networkidle" });
}

const auditScript = () => ({
  anims: document.getAnimations().map((a) => ({
    name: a.animationName ?? "(waapi)",
    state: a.playState,
    target: a.effect?.target
      ? `${a.effect.target.tagName}.${(a.effect.target.className || "").toString().split(" ").slice(0, 2).join(".")}`
      : "?",
    duration: Math.round(a.effect?.getTiming?.().duration ?? 0),
  })),
  canvases: [...document.querySelectorAll("canvas")].map(
    (c) => ({ cls: c.className?.toString().slice(0, 60), w: c.width, h: c.height }),
  ),
  fixedCount: document.querySelectorAll(".fixed, .sticky").length,
  media: {
    coarse: matchMedia("(pointer: coarse)").matches,
    fine: matchMedia("(pointer: fine)").matches,
    width: window.innerWidth,
    cores: navigator.hardwareConcurrency ?? 0,
    saveData: (navigator.connection?.saveData ?? false),
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  },
});

const measureFps = () =>
  new Promise((resolve) => {
    const gaps = [];
    let last = performance.now();
    const step = (t) => {
      gaps.push(t - last); last = t;
      if (gaps.length < 121) requestAnimationFrame(step);
      else resolve(Math.round((1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)) * 10) / 10);
    };
    requestAnimationFrame(step);
  });

async function main() {
  const child = spawn("npx", ["--no-install", "next", "start", "-p", "3003"], {
    cwd: ROOT, stdio: "ignore", shell: true,
  });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch({ headless: true });
    for (const route of routes) {
      const context = await browser.newContext({ ...devices["iPhone 14"] });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      // Headless Chromium still reports a fine pointer even under phone
      // emulation; force the coarse pointer a real touch device reports so the
      // classification and the CSS tiers actually exercise the mobile path.
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "pointer", value: "coarse" },
          { name: "any-pointer", value: "coarse" },
        ],
      });
      await cdp.send("Performance.enable");
      let longTasks = 0, longMs = 0;
      await context.addInitScript(() => {
        window.__lt = [];
        try {
          new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); })
            .observe({ type: "longtask", buffered: true });
        } catch {}
      });
      await openRoute(page, route);
      await page.waitForTimeout(4000);
      const t0 = (await cdp.send("Performance.getMetrics")).metrics
        .reduce((o, m) => ({ ...o, [m.name]: m.value }), {});
      await page.waitForTimeout(windowMs);
      const t1 = (await cdp.send("Performance.getMetrics")).metrics
        .reduce((o, m) => ({ ...o, [m.name]: m.value }), {});
      const lt = await page.evaluate(() => window.__lt);
      const fps = await page.evaluate(measureFps);
      const audit = await page.evaluate(auditScript);
      const running = audit.anims.filter((a) => a.state === "running");
      const names = {};
      for (const a of running) names[a.name] = (names[a.name] ?? 0) + 1;
      console.log(`\n=== ${route} (${windowMs}ms, cpu throttled) ===`);
      console.log(`  fps=${fps} longTasks=${lt.length} longMs=${Math.round(lt.reduce((a, b) => a + b, 0))}`);
      console.log(`  taskΔ=${Math.round((t1.TaskDuration - t0.TaskDuration) * 10) / 10}s ` +
        `scriptΔ=${Math.round((t1.ScriptDuration - t0.ScriptDuration) * 10) / 10}s ` +
        `layoutΔ=${Math.round(t1.LayoutDuration - t0.LayoutDuration)}s`);
      console.log(`  running animations: ${running.length}`);
      for (const n of Object.keys(names).sort((a, b) => names[b] - names[a])) {
        console.log(`    ${n} ×${names[n]}`);
      }
      console.log(`  fixed/sticky nodes: ${audit.fixedCount}`);
      console.log(`  canvases: ${audit.canvases.length ? JSON.stringify(audit.canvases) : "none"}`);
      console.log(`  canvas class: ${audit.canvases[0]?.cls ?? "none"}`);
      console.log(`  media: ${JSON.stringify(audit.media)}`);
      await context.close();
    }
    await browser.close();
  } finally {
    child.kill();
    if (process.platform === "win32") {
      await new Promise((r) => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]).on("exit", r));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });