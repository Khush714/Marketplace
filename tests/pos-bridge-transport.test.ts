/**
 * Regression tests for the POS bridge transport.
 *
 * Run with: npm test
 *
 * Production shipped `POS_BASE_URL` pointing at a `trycloudflare.com` quick
 * tunnel that had already stopped resolving, and the resulting 502 on
 * POST /api/partner/integrations/verify was undiagnosable: all four bridge
 * clients caught the fetch failure with a bare `catch {}` and rethrew a generic
 * "POS is unreachable", so the function logs held nothing and the only symptom
 * was a 502 in a browser console. These pin the two things that were missing —
 * a classified cause, and a guard that refuses a base URL a deployed function
 * can never reach.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PosBridgeError,
  describePosTransportError,
  posBaseUrlProblem,
  requirePosBaseUrl,
} from "../src/lib/pos-bridge";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("an unset POS_BASE_URL is reported as not configured, on any environment", () => {
  withEnv({ POS_BASE_URL: undefined }, () => {
    assert.equal(posBaseUrlProblem()?.reason, "not_configured");
    assert.throws(() => requirePosBaseUrl(), (e: unknown) => e instanceof PosBridgeError && e.status === 503);
  });
});

test("a deployed function refuses a loopback POS_BASE_URL", () => {
  // The exact trap: localhost is correct in local dev and dead once deployed,
  // where it resolves to the function's own container. A bare 502 is what this
  // used to produce.
  withEnv({ POS_BASE_URL: "http://localhost:5000", VERCEL_ENV: "production" }, () => {
    assert.equal(posBaseUrlProblem()?.reason, "loopback_in_production");
    assert.throws(
      () => requirePosBaseUrl(),
      (e: unknown) => e instanceof PosBridgeError && e.status === 503,
    );
  });

  for (const host of ["http://127.0.0.1:5000", "http://[::1]:5000", "http://0.0.0.0:5000"]) {
    withEnv({ POS_BASE_URL: host, VERCEL_ENV: "production" }, () => {
      assert.equal(posBaseUrlProblem()?.reason, "loopback_in_production", host);
    });
  }
});

test("loopback stays legal in local development", () => {
  withEnv({ POS_BASE_URL: "http://localhost:5000", VERCEL_ENV: "development" }, () => {
    assert.equal(posBaseUrlProblem(), null);
    assert.equal(requirePosBaseUrl(), "http://localhost:5000");
  });
});

test("a deployed public POS URL passes the guard, with the trailing slash normalised", () => {
  withEnv({ POS_BASE_URL: "https://pos.example.com/api/", VERCEL_ENV: "production" }, () => {
    assert.equal(posBaseUrlProblem(), null);
    assert.equal(requirePosBaseUrl(), "https://pos.example.com/api");
  });
});

test("a DNS failure is classified as a network error, not a generic 502", () => {
  // This is the failure the quick tunnel produced: undici surfaces the resolver
  // code on `cause`, and dropping it is what made the outage unreadable.
  const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  assert.deepEqual(describePosTransportError(err), {
    reason: "network",
    detail: "DNS lookup failed (ENOTFOUND)",
  });
});

test("a refused connection and a TLS failure stay distinguishable", () => {
  const refused = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:5000" },
  });
  assert.equal(describePosTransportError(refused).reason, "network");
  assert.match(describePosTransportError(refused).detail, /ECONNREFUSED/);

  const tls = Object.assign(new TypeError("fetch failed"), {
    cause: { code: "CERT_HAS_EXPIRED", message: "certificate has expired" },
  });
  assert.match(describePosTransportError(tls).detail, /CERT_HAS_EXPIRED/);
});

test("an aborted request is reported as a timeout, not a network error", () => {
  // A 502 means "the POS is down"; a timeout means "the POS is too slow". The
  // operator action differs, so the distinction has to survive.
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.equal(describePosTransportError(aborted).reason, "timeout");
});
