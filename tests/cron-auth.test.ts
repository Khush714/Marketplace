/**
 * Tests for the scheduled-drain authorization decision.
 *
 * Run with: npm test
 *
 * The in-process POS drain loop cannot run on a serverless host, so the drains
 * moved to scheduled HTTP endpoints. That trades an internal timer for a
 * privileged public route, and the two failure modes worth pinning are:
 *
 *   - Open drain. An unauthenticated caller could drive the delivery journal,
 *     burn the POS's rate limit and keep retrying other tenants' orders. With
 *     neither secret configured the decision must be `unconfigured`, never
 *     `authorized`, so the route fails closed.
 *   - Spoofed scheduler header. `x-vercel-cron` is only trustworthy because the
 *     platform injects it on requests it originates; off Vercel it must not
 *     authenticate anyone.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decideCronAuth, type HeaderLookup } from "../src/lib/cron-auth-core";

function headers(map: Record<string, string>): HeaderLookup {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

test("with neither secret configured the decision is unconfigured, never authorized", () => {
  const env = { onVercel: true };
  assert.equal(decideCronAuth(headers({ "x-vercel-cron": "1" }), env), "unconfigured");
  assert.equal(decideCronAuth(headers({}), env), "unconfigured");
});

test("the ops token authorizes the drain", () => {
  const env = { opsToken: "ops-secret", onVercel: true };
  assert.equal(decideCronAuth(headers({ "x-ops-token": "ops-secret" }), env), "authorized");
});

test("a wrong or truncated ops token is unauthorized", () => {
  const env = { opsToken: "ops-secret", onVercel: true };
  assert.equal(decideCronAuth(headers({ "x-ops-token": "nope" }), env), "unauthorized");
  assert.equal(decideCronAuth(headers({ "x-ops-token": "ops-secre" }), env), "unauthorized");
  assert.equal(decideCronAuth(headers({ "x-ops-token": "ops-secretx" }), env), "unauthorized");
  assert.equal(decideCronAuth(headers({}), env), "unauthorized");
});

test("a bearer CRON_SECRET authorizes the drain", () => {
  const env = { cronSecret: "cron-secret" };
  assert.equal(decideCronAuth(headers({ authorization: "Bearer cron-secret" }), env), "authorized");
  assert.equal(decideCronAuth(headers({ authorization: "Bearer wrong" }), env), "unauthorized");
});

test("a bare CRON_SECRET without the Bearer scheme is not accepted", () => {
  const env = { cronSecret: "cron-secret" };
  assert.equal(decideCronAuth(headers({ authorization: "cron-secret" }), env), "unauthorized");
  assert.equal(decideCronAuth(headers({ authorization: "bearer cron-secret" }), env), "unauthorized");
});

test("a spoofed x-vercel-cron header authenticates nothing off Vercel", () => {
  const env = { cronSecret: "cron-secret", onVercel: false };
  assert.equal(decideCronAuth(headers({ "x-vercel-cron": "1" }), env), "unauthorized");
});

test("a spoofed x-vercel-cron header is not enough when no secret is configured", () => {
  assert.equal(decideCronAuth(headers({ "x-vercel-cron": "1" }), {}), "unconfigured");
});

test("a genuine Vercel Cron invocation is trusted when a secret is configured", () => {
  const env = { cronSecret: "cron-secret", onVercel: true };
  assert.equal(decideCronAuth(headers({ "x-vercel-cron": "1" }), env), "authorized");
});

test("header lookup is case-insensitive", () => {
  const env = { opsToken: "ops-secret", onVercel: true };
  assert.equal(decideCronAuth(headers({ "X-Ops-Token": "ops-secret" }), env), "authorized");
  assert.equal(decideCronAuth(headers({ Authorization: "Bearer cron-secret" }), { cronSecret: "cron-secret" }), "authorized");
});

/* --------------------------- route wiring -------------------------------- */

/**
 * `decideCronAuth` only protects a route that calls it. The internal drain used
 * to hand-roll its own `provided !== secret` comparison — a plain inequality on
 * a bearer secret, which is exactly what the header comment in this module
 * says must never happen — and accepted nothing but `CRON_SECRET`.
 */
function routeSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const DRAIN_ROUTES = [
  "src/app/api/cron/pos-drain/route.ts",
  "src/app/api/cron/payments-drain/route.ts",
  "src/app/api/internal/pos-delivery-drain/route.ts",
];

test("every scheduled drain routes its decision through the shared guard", () => {
  for (const path of DRAIN_ROUTES) {
    const source = routeSource(path);
    assert.match(source, /requireCronAuth\(req\)/, `${path} must call requireCronAuth`);
    assert.doesNotMatch(source, /provided !==/, `${path} must not hand-roll the comparison`);
    assert.doesNotMatch(source, /!==\s*secret/, `${path} must not hand-roll the comparison`);
    assert.doesNotMatch(source, /timingSafeEqual/, `${path} must not re-implement the comparison either`);
  }
});

test("the guard runs before the drain does any work", () => {
  for (const path of DRAIN_ROUTES) {
    const source = routeSource(path);
    // Only the exported handler counts: `cron/pos-drain` defines `run()` above
    // it, and the drain it wraps is legitimately earlier in the file.
    const handlerAt = source.search(/export async function (POST|GET)/);
    assert.ok(handlerAt >= 0, `${path} has no exported handler`);
    const handler = source.slice(handlerAt);
    const authAt = handler.search(/requireCronAuth\(req\)/);
    assert.ok(authAt >= 0, `${path} lost its guard`);

    const candidates = [
      handler.search(/processPending\w+\(/),
      handler.search(/\brun\(/),
      handler.search(/reconcilePayments\(/),
    ].filter((i) => i >= 0);
    if (candidates.length) {
      assert.ok(authAt < Math.min(...candidates), `${path} drains before it authenticates`);
    }
  }
});