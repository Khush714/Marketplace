/**
 * Tests for the Phase 12 security event stream.
 *
 * Run with: npm test
 *
 * Phase 12 has three claims, and each one is pinned here rather than trusted:
 *
 *   - the vocabulary: exactly the eleven events the roadmap names, no more,
 *     no fewer, and every one of them actually wired into a call site (a
 *     named event nobody emits is worse than no event — it looks covered);
 *   - the never-log guarantee: the six forbidden classes (database password,
 *     owner key, integration bearer token, admin session token, payment
 *     secret, full customer address) plus their credential-class siblings
 *     are redacted INSIDE buildSecurityEvent, which every emission passes
 *     through — so the rule cannot be bypassed by a forgetful call site;
 *   - call-site discipline: the fields that reach emitSecurityEvent are
 *     drawn from a boring allowlist of identifiers (ids, reasons, bucket
 *     keys). Redaction is the backstop; this is the front stop that keeps
 *     raw credentials from ever being offered for redaction at all.
 *
 * The wiring checks are static, like the rest of the suite: routes cannot
 * run under `node --test`, so what is asserted is that each source file
 * calls emitSecurityEvent with the right event name — which, combined with
 * the core's redaction tests, is the whole contract.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SECURITY_EVENTS,
  buildSecurityEvent,
  formatSecurityEvent,
  redactEventFields,
  REDACTED,
} from "../src/lib/security/security-events-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** All emission calls in one file: event name + the object literal text. */
function emitCalls(src: string): Array<{ name: string; args: string }> {
  const out: Array<{ name: string; args: string }> = [];
  const re = /emitSecurityEvent\(\s*"([^"]+)"\s*,/g;
  for (const m of src.matchAll(re)) {
    const start = m.index + m[0].length;
    const end = src.indexOf(");", start);
    out.push({ name: m[1], args: src.slice(start, end) });
  }
  return out;
}

/** Every key an emission passes, including object shorthand forms. */
function emittedKeys(args: string): string[] {
  const keys: string[] = [];
  const colon = /(?:^|[,{])\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s*:)/g;
  const shorthand = /(?:^|[,{])\s*([A-Za-z_][A-Za-z0-9_]*)(?=\s*[,}])/g;
  for (const re of [colon, shorthand]) {
    for (const m of args.matchAll(re)) keys.push(m[1]);
  }
  return keys;
}

const ALL_SRC = globSync("src/**/*.ts").map((file) => ({ file, src: readSource(file) }));

/* ------------------------------ vocabulary ------------------------------ */

test("the vocabulary is exactly the eleven Phase 12 events", () => {
  assert.deepEqual([...SECURITY_EVENTS], [
    "admin_login",
    "connection_code_created",
    "connection_code_redeemed",
    "restaurant_session_created",
    "restaurant_session_revoked",
    "integration_login",
    "passkey_rotated",
    "restaurant_deleted",
    "payment_webhook_failure",
    "order_tracking_suspicious",
    "rate_limit_violation",
  ]);
});

test("no vocabulary entry is dead: every event is emitted somewhere", () => {
  const emitted = new Set(
    ALL_SRC.flatMap(({ src }) => emitCalls(src).map((call) => call.name)),
  );
  for (const name of SECURITY_EVENTS) {
    assert.ok(emitted.has(name), `no call site emits "${name}"`);
  }
});

test("no call site invents an event name outside the vocabulary", () => {
  const valid = new Set<string>(SECURITY_EVENTS);
  for (const { file, src } of ALL_SRC) {
    for (const call of emitCalls(src)) {
      assert.ok(valid.has(call.name), `${file} emits unknown event "${call.name}"`);
    }
  }
});

/* ------------------------- the never-log guarantee ---------------------- */

test("the six never-log classes are redacted before formatting", () => {
  const event = buildSecurityEvent("admin_login", {
    password: "s3cret-db-pw", // 1. database password
    ownerKey: "own_live_abc123", // 2. owner key
    bearerToken: "int_session_bearer", // 3. integration bearer token
    sessionToken: "admin_session_cookie", // 4. admin session token
    webhookSecret: "whsec_payment_secret", // 5. payment secret
    addressText: "221B Baker Street, London", // 6. full customer address
  });
  for (const key of [
    "password",
    "ownerKey",
    "bearerToken",
    "sessionToken",
    "webhookSecret",
    "addressText",
  ]) {
    assert.equal(event[key], REDACTED, `${key} must never reach the log`);
  }
  assert.equal(event.event, "admin_login");
  assert.ok(event.at, "the envelope timestamp survives redaction");
});

test("redaction is case- and punctuation-insensitive", () => {
  const event = buildSecurityEvent("admin_login", {
    OWNER_KEY: "k1",
    owner_key: "k2",
    DATABASE_URL: "postgres://app:pw@db/prod",
    AddressText: "Full street address here",
    X_OWNER_KEY_HEADER: "k3",
  });
  assert.equal(event.OWNER_KEY, REDACTED);
  assert.equal(event.owner_key, REDACTED);
  assert.equal(event.DATABASE_URL, REDACTED);
  assert.equal(event.AddressText, REDACTED);
  assert.equal(event.X_OWNER_KEY_HEADER, REDACTED);
});

test("a secret under an innocent key is caught by value shape", () => {
  const event = buildSecurityEvent("payment_webhook_failure", {
    endpoint: "postgres://marketplace:dbpw@internal:5432/app",
    reason: "invalid_signature",
  });
  assert.equal(event.endpoint, REDACTED, "connection-string values carry the password");
  assert.equal(event.reason, "invalid_signature", "ordinary context survives");
});

test("redaction recurses through nested context", () => {
  const event = buildSecurityEvent("integration_login", {
    attempt: { ip: "10.0.0.1", headers: { authorization: "Bearer abc" } },
    tokens: ["sess_1", "sess_2"],
  });
  assert.deepEqual(event.attempt, { ip: "10.0.0.1", headers: { authorization: REDACTED } });
  // The key itself matches /token/, so the array is replaced wholesale.
  assert.equal(event.tokens, REDACTED);
});

test("boring identifiers pass through untouched", () => {
  const fields = {
    restaurantId: 42,
    sessionId: 7,
    codeId: 9,
    daysValid: 30,
    bucket: "integrationLogin:203.0.113.9",
    limit: 10,
    windowMs: 600000,
    retryAfterSeconds: 42,
    ip: "203.0.113.9",
    allSessions: true,
    restaurantName: "Trattoria Roma",
    reason: "invalid_credentials",
    outcome: "failure",
  };
  const event = buildSecurityEvent("rate_limit_violation", fields);
  for (const [key, value] of Object.entries(fields)) {
    assert.deepEqual(event[key], value, `${key} should be logged verbatim`);
  }
});

test("context cannot override the envelope's event name or timestamp", () => {
  const event = buildSecurityEvent("admin_login", {
    event: "forged_event",
    at: "not-a-timestamp",
    outcome: "failure",
  });
  assert.equal(event.event, "admin_login");
  assert.notEqual(event.at, "not-a-timestamp");
  assert.equal(event.outcome, "failure");
});

test("formatSecurityEvent is one parseable JSON line", () => {
  const line = formatSecurityEvent(buildSecurityEvent("restaurant_deleted", { restaurantId: 1 }));
  assert.ok(!line.includes("\n"), "one line per event");
  const parsed = JSON.parse(line) as { event: string; at: string; restaurantId: number };
  assert.equal(parsed.event, "restaurant_deleted");
  assert.equal(parsed.restaurantId, 1);
  assert.ok(Number.isFinite(Date.parse(parsed.at)));
});

test("redactEventFields is exported for direct auditing", () => {
  const redacted = redactEventFields({ ownerKeyHash: "abc", codeId: 5 });
  assert.deepEqual(redacted, { ownerKeyHash: REDACTED, codeId: 5 });
});

/* -------------------------------- wiring -------------------------------- */

const SITES: Array<{ event: string; files: string[] }> = [
  { event: "admin_login", files: ["src/lib/ops-auth.ts"] },
  { event: "connection_code_created", files: ["src/app/api/partner/codes/route.ts"] },
  { event: "connection_code_redeemed", files: ["src/app/api/partner/connect/route.ts"] },
  { event: "restaurant_session_created", files: ["src/db/queries.ts"] },
  { event: "restaurant_session_revoked", files: ["src/db/queries.ts"] },
  { event: "integration_login", files: ["src/app/api/integration/login/route.ts"] },
  { event: "passkey_rotated", files: ["src/app/api/integration/passkey/rotate/route.ts"] },
  { event: "restaurant_deleted", files: ["src/app/api/partner/restaurant/route.ts"] },
  {
    event: "payment_webhook_failure",
    files: ["src/app/api/integrations/payments/webhook/route.ts"],
  },
  {
    event: "order_tracking_suspicious",
    files: ["src/app/api/orders/track/[trackingToken]/route.ts"],
  },
  {
    event: "rate_limit_violation",
    files: [
      "src/lib/security/rate-limit.ts",
      "src/app/api/integrations/payments/webhook/route.ts",
    ],
  },
];

for (const site of SITES) {
  test(`wiring: ${site.event} is emitted from its designated site(s)`, () => {
    for (const file of site.files) {
      const src = readSource(file);
      assert.ok(
        src.includes(`emitSecurityEvent("${site.event}"`),
        `${file} must emit "${site.event}"`,
      );
      const importsEmitter =
        src.includes('from "@/lib/security/security-events"') ||
        src.includes('from "./security-events"');
      assert.ok(importsEmitter, `${file} must import the emitter`);
    }
  });
}

test("rate-limit violations emit from the shared limiter, inside the refusal branch", () => {
  const src = readSource("src/lib/security/rate-limit.ts");
  const refusalAt = src.indexOf("existing.count > limit");
  const emitAt = src.indexOf('emitSecurityEvent("rate_limit_violation"');
  assert.ok(refusalAt !== -1, "the over-budget branch exists");
  assert.ok(emitAt > refusalAt, "the emission sits inside the refusal branch");
});

test("the abuse budgets rely on that shared limiter instead of logging themselves", () => {
  const src = readSource("src/lib/abuse.ts");
  assert.match(src, /checkRateLimit\(clientKey\(req, scope\)/);
  assert.ok(
    !src.includes("emitSecurityEvent"),
    "guardBudget must not duplicate the emission the limiter already makes",
  );
});

test("the emitter formats through buildSecurityEvent, so redaction cannot be bypassed", () => {
  const src = readSource("src/lib/security/security-events.ts");
  assert.match(src, /buildSecurityEvent\(/);
  assert.match(src, /formatSecurityEvent\(/);
  assert.match(src, /console\.error\(/);
});

/* --------------------- call-site discipline (front stop) ----------------- */

/**
 * Keys that emissions are allowed to pass. Deliberately boring: ids, reasons
 * and limiter telemetry. Anything else appearing here means a call site
 * offered the logger a field that then had to be rescued by redaction — the
 * whole point is that neither half has to trust the other.
 */
const SAFE_EMITTED_KEYS = new Set([
  "outcome",
  "reason",
  "restaurantId",
  "sessionId",
  "codeId",
  "daysValid",
  "allSessions",
  "restaurantName",
  "bucket",
  "limit",
  "windowMs",
  "retryAfterSeconds",
  "ip",
]);

test("every emission passes only allowlisted identifier fields", () => {
  let checked = 0;
  for (const { file, src } of ALL_SRC) {
    for (const call of emitCalls(src)) {
      checked += 1;
      for (const key of emittedKeys(call.args)) {
        assert.ok(
          SAFE_EMITTED_KEYS.has(key),
          `${file} emits "${call.name}" with non-allowlisted field "${key}"`,
        );
      }
    }
  }
  assert.ok(checked >= 20, `expected the full wiring to be scanned, saw ${checked} calls`);
});
