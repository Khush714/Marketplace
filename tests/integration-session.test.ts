/**
 * Tests for the integration session policy and its route wiring.
 *
 * Run with: npm test
 *
 * The POS-side handshake lives in the query layer (`server-only`, untestable
 * here) but the *policy* is shared with it through `integration-session-core.ts`
 * — liveness across two clocks, and the sliding-window arithmetic — so the
 * decisions are pinned here, not scattered through `db` calls:
 *
 *   - Two clocks, deliberately: an absolute ceiling (`expires_at`) that no
 *     amount of activity may extend, and an idle window (`idle_expires_at`)
 *     that only activity keeps alive. A stolen token's transport looks like a
 *     busy POS; the idle window is what makes its first silence lethal.
 *   - Fails closed on every ambiguity: revoked, expired-on-either-clock, a row
 *     with no idle column, and no row at all are all refused.
 *   - Routes actually wired: rotation is bearer-gated and the legacy
 *     code+passkey body is gone; logout revokes exactly one session; login
 *     records mint-time metadata and the idle bound.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INTEGRATION_SESSION_IDLE_TTL_MS,
  INTEGRATION_SESSION_TOKEN_BYTES,
  INTEGRATION_SESSION_TTL_MS,
  integrationSessionIsLive,
  nextIdleExpiry,
  type IntegrationSessionRowLike,
} from "../src/lib/integration-session-core";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function row(overrides: Partial<IntegrationSessionRowLike> = {}): IntegrationSessionRowLike {
  return {
    expiresAt: new Date(Date.now() + INTEGRATION_SESSION_TTL_MS),
    idleExpiresAt: new Date(Date.now() + INTEGRATION_SESSION_IDLE_TTL_MS),
    revokedAt: null,
    ...overrides,
  };
}

/* --------------------------------- clocks --------------------------------- */

test("the idle window is strictly shorter than the absolute ceiling", () => {
  // If idle were >= absolute, the idle check would be dead code: nothing would
  // ever be refused by the idle window that the absolute ceiling had not
  // already refused. The ordering is the whole point of having two clocks.
  assert.ok(INTEGRATION_SESSION_TTL_MS > 0);
  assert.ok(INTEGRATION_SESSION_IDLE_TTL_MS > 0);
  assert.ok(INTEGRATION_SESSION_IDLE_TTL_MS < INTEGRATION_SESSION_TTL_MS);
});

test("nextIdleExpiry slides the window out from now, not from mint time", () => {
  const now = Date.now();
  const next = nextIdleExpiry(now);
  assert.equal(next.getTime(), now + INTEGRATION_SESSION_IDLE_TTL_MS);
  // A later heartbeat moves the window again; it is not pinned at minting.
  const later = nextIdleExpiry(now + 5 * 60 * 1000);
  assert.equal(later.getTime(), now + 5 * 60 * 1000 + INTEGRATION_SESSION_IDLE_TTL_MS);
});

/* -------------------------------- liveness --------------------------------- */

test("null rows and revoked sessions are not live", () => {
  assert.equal(integrationSessionIsLive(null), false);
  assert.equal(integrationSessionIsLive(undefined), false);
  assert.equal(integrationSessionIsLive(row({ revokedAt: new Date() })), false);
  // Revoked is checked first: a revocation must read as dead even against a
  // perfectly good pair of future clocks.
  assert.equal(
    integrationSessionIsLive(
      row({ revokedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60 * 1000) }),
    ),
    false,
  );
});

test("the absolute ceiling is enforced at its boundary", () => {
  assert.equal(integrationSessionIsLive(row()), true);
  // Exact boundary is already too late, on both clocks.
  assert.equal(
    integrationSessionIsLive(row({ expiresAt: new Date(Date.now()) })),
    false,
    "expiring exactly now is not live",
  );
});

test("the idle window is enforced at its boundary", () => {
  assert.equal(
    integrationSessionIsLive(row({ idleExpiresAt: new Date(Date.now() + 1000) })),
    true,
    "live inside the idle window regardless of idle expiry",
  );
  assert.equal(
    integrationSessionIsLive(row({ idleExpiresAt: new Date(Date.now() - 1) })),
    false,
  );
  assert.equal(
    integrationSessionIsLive(row({ idleExpiresAt: new Date(Date.now()) })),
    false,
    "idle expiring exactly now is not live",
  );
  // Even against a far-future absolute clock: the idle window is the constraint.
  assert.equal(
    integrationSessionIsLive(
      row({ idleExpiresAt: new Date(Date.now() - 60 * 1000), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }),
    ),
    false,
  );
});

test("a row with no idle column fails closed", () => {
  // The migration backfills it and every mint sets it, so a missing idle window
  // is a symptom, not a row to forgive. Treating it as "no idle limit" would
  // silently waive the control this policy is built around.
  assert.equal(integrationSessionIsLive(row({ idleExpiresAt: null })), false);
});

/* ------------------------------ token geometry ----------------------------- */

test("the token size matches the minted access token", () => {
  // `makeAccessToken` is 24 random bytes (base64url). If the two ever diverge
  // the session store and the policy line up differently than the docs claim.
  assert.equal(INTEGRATION_SESSION_TOKEN_BYTES, 24);
});

/* -------------------------------- wiring ----------------------------------- */

test("passkey rotation is bearer-gated and the code+passkey body is gone", () => {
  const source = readSource("src/app/api/integration/passkey/rotate/route.ts");
  assert.match(source, /requireIntegrationAuth\(req\)/);
  assert.match(source, /rotatePasskeyAsRestaurant\(restaurant\.id\)/);
  assert.match(source, /revokeIntegrationSessions\(restaurant\.id\)/, "old sessions die with the rotation");
  assert.doesNotMatch(source, /body\.code/, "the legacy code handshake must be gone");
  assert.doesNotMatch(source, /current_passkey/, "the passkey being replaced must not travel in the body");
  assert.doesNotMatch(source, /rotatePasskey\(/, "the session-less rotation entry point must be gone");
  assert.doesNotMatch(source, /req\.json\(\)/, "rotation must not need a body at all");
});

test("logout revokes exactly the presented session", () => {
  const source = readSource("src/app/api/integration/logout/route.ts");
  assert.match(source, /requireIntegrationAuth\(req\)/, "logout is authorized");
  assert.match(source, /logoutIntegrationSession\(parseBearerToken\(req\)\)/, "it revokes by token, not by restaurant");
  assert.match(source, /recordIntegrationAudit/, "the sign-out is on the trail");
});

test("login records mint-time metadata and the idle bound", () => {
  const source = readSource("src/app/api/integration/login/route.ts");
  assert.match(source, /ipAddress: req\.headers\.get\("x-forwarded-for"\)/);
  assert.match(source, /userAgent: req\.headers\.get\("user-agent"\)/);
  assert.match(source, /tokenIdleExpiresAt/, "the client learns when its session idles out");
});

test("the bearer token parser is shared, not copy-pasted per route", () => {
  const source = readSource("src/app/api/integration/_auth.ts");
  assert.match(source, /export function parseBearerToken/);
  assert.match(source, /requireIntegrationAuth/, "the resolver still sits behind the shared parser");
});