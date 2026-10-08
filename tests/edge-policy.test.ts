/**
 * Tests for the Proxy network-boundary policy.
 *
 * Run with: npm test
 *
 * These cover the decisions in `edge-policy-core.ts` — the pure functions the
 * Proxy runs before a request reaches a route handler. The Proxy itself cannot
 * be imported here (it pulls `server-only` and `next/server`), which is exactly
 * why the decisions live in a file `node --test` can load.
 *
 * The policy is coarse on purpose, and every assertion here is a check that it
 * fails closed: an unknown method, host or declared size is refused, never
 * passed through to become a route handler's problem.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOW_HEADER_VALUE,
  ALLOWED_METHODS,
  HSTS_VALUE,
  MAX_DECLARED_BODY_BYTES,
  declaredTooLarge,
  hostAllowed,
  methodAllowed,
  normalizeHost,
  type HostAllowlist,
} from "../src/lib/edge-policy-core";

/* -------------------------------- methods -------------------------------- */

test("the method allowlist admits exactly the application surface", () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.equal(methodAllowed(method), true, `${method} must be allowed`);
  }
  assert.equal(methodAllowed("get"), true, "methods are matched case-insensitively");
  for (const method of ["TRACE", "CONNECT", "PURGE", "BREW"]) {
    assert.equal(methodAllowed(method), false, `${method} must be refused`);
  }
  assert.equal(methodAllowed(""), false);
  assert.equal(methodAllowed(null), false);
  assert.equal(methodAllowed(undefined), false);
});

test("the Allow header advertises every permitted method", () => {
  for (const method of ALLOWED_METHODS) {
    assert.ok(ALLOW_HEADER_VALUE.includes(method), `Allow must list ${method}`);
  }
});

/* --------------------------------- hosts --------------------------------- */

function allow(partial: Partial<HostAllowlist>): HostAllowlist {
  return { exact: [], vercelPreview: false, localhost: false, ...partial };
}

test("a Host header is normalized to a lowercase, port-stripped hostname", () => {
  assert.equal(normalizeHost("App.Example:3000"), "app.example");
  assert.equal(normalizeHost("app.example"), "app.example");
  assert.equal(normalizeHost("localhost"), "localhost");
  assert.equal(normalizeHost("[::1]:3000"), "[::1]");
  assert.equal(normalizeHost("  "), null);
  assert.equal(normalizeHost(""), null);
  assert.equal(normalizeHost(null), null);
});

test("the host allowlist fails closed with nothing configured", () => {
  const h = allow({});
  assert.equal(hostAllowed("app.example", h), false, "an unlisted host is nobody's problem");
  assert.equal(hostAllowed(null, h), false);
  assert.equal(hostAllowed("", h), false);
});

test("an exact host is served, case-insensitively and with a port ignored", () => {
  const h = allow({ exact: ["app.example"] });
  assert.equal(hostAllowed("app.example", h), true);
  assert.equal(hostAllowed("APP.EXAMPLE:3000", h), true);
  assert.equal(hostAllowed("other.example", h), false);
});

test("vercel preview hosts are served only when previews are accepted", () => {
  const h = allow({ exact: ["app.example"], vercelPreview: true });
  assert.equal(hostAllowed("app.vercel.app", h), true);
  assert.equal(hostAllowed("pr-42.vercel.app", h), true);
  assert.equal(hostAllowed("notvercel.app", h), false);
  assert.equal(hostAllowed("evil.vercel.app", h), true, "still a host we own on Vercel");
  const strict = allow({ exact: ["app.example"] });
  assert.equal(hostAllowed("app.vercel.app", strict), false);
});

test("localhost is served only outside production", () => {
  assert.equal(hostAllowed("localhost", allow({ localhost: true })), true);
  assert.equal(hostAllowed("127.0.0.1", allow({ localhost: true })), true);
  assert.equal(hostAllowed("[::1]", allow({ localhost: true })), true);
  assert.equal(hostAllowed("localhost", allow({})), false);
});

/* ------------------------------ declared size ---------------------------- */

test("an absurd declared content-length is refused up front", () => {
  assert.equal(MAX_DECLARED_BODY_BYTES, 1024 * 1024);
  assert.equal(declaredTooLarge("1048577", MAX_DECLARED_BODY_BYTES), true);
  assert.equal(declaredTooLarge("1048576", MAX_DECLARED_BODY_BYTES), false, "at the cap is allowed");
  assert.equal(declaredTooLarge("0", MAX_DECLARED_BODY_BYTES), false);
});

test("a chunked request declares no length and is not refused here", () => {
  // Nothing to act on: the stream caps in the handlers are the authority.
  assert.equal(declaredTooLarge("", MAX_DECLARED_BODY_BYTES), false);
  assert.equal(declaredTooLarge(null, MAX_DECLARED_BODY_BYTES), false);
  assert.equal(declaredTooLarge("not a number", MAX_DECLARED_BODY_BYTES), false);
});

test("HSTS is a bounded, HTTPS-only value", () => {
  assert.match(HSTS_VALUE, /^max-age=\d+$/);
});