#!/usr/bin/env node
/**
 * Minimal browser smoke test (Phase 5 E2E).
 *
 * No @playwright/test runner: the repo carries the `playwright` package only, so
 * this is a small self-contained script. It boots the already-built production
 * server (`next start`) on a free port, drives a real Chromium against the
 * public surface a diner actually sees, then tears the server down.
 *
 * Prerequisites (provided by .github/workflows/e2e.yml):
 *   - `npm run build` has produced .next/
 *   - DATABASE_URL points at a migrated database (see scripts/db-bootstrap.mjs)
 *   - the runtime secrets (ORDER_TOKEN_SECRET, etc.) are set
 *   - Chromium is installed (`npx playwright install --with-deps chromium`)
 *
 * Exits non-zero on the first failed expectation.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

function fail(message) {
  console.error(`e2e: FAIL — ${message}`);
  process.exitCode = 1;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

async function waitForServer(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/privacy`);
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`e2e: ok   ${label}`);
  } else {
    fail(`${label}${detail ? ` (${detail})` : ""}`);
  }
}

if (!existsSync(nextBin)) {
  console.error("e2e: FAIL — next CLI not found; run `npm install` and `npm run build` first");
  process.exit(1);
}
if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
  console.error("e2e: FAIL — .next/BUILD_ID missing; run `npm run build` first");
  process.exit(1);
}

// An externally-provided server (E2E_BASE_URL) is used as-is; otherwise this
// script owns the lifecycle of a fresh `next start` on a free port.
const externalBase = process.env.E2E_BASE_URL;
const port = externalBase ? null : await freePort();
const base = externalBase ?? `http://localhost:${port}`;
const server = port
  ? spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
      stdio: "ignore",
    })
  : null;

let browser;
try {
  const up = await waitForServer(base, 90_000);
  if (!up) {
    fail("server did not become ready in time");
  } else {
    browser = await chromium.launch();
    const page = await browser.newPage();

    const home = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    check("GET / returns 200", home?.status() === 200, `status ${home?.status()}`);
    check("GET / renders a heading", (await page.locator("h1").count()) > 0);

    const privacy = await page.goto(`${base}/privacy`, { waitUntil: "domcontentloaded" });
    check("GET /privacy returns 200", privacy?.status() === 200, `status ${privacy?.status()}`);
    check("GET /privacy renders a heading", (await page.locator("h1").count()) > 0);

    const health = await page.request.get(`${base}/api/health`);
    check("GET /api/health returns 200", health.status() === 200, `status ${health.status()}`);
    check("GET /api/health reports ok:true", health.status() === 200 && (await health.json()).ok === true);

    const missing = await page.request.get(`${base}/definitely-not-a-page`);
    check("unknown route returns 404", missing.status() === 404, `status ${missing.status()}`);
  }
} catch (e) {
  fail(String(e));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

console.log(process.exitCode ? "e2e: FAILED" : "e2e: PASSED");
