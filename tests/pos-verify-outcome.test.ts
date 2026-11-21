/**
 * Regression tests for verify-step failure classification.
 *
 * Run with: npm test
 *
 * After the POS_BASE_URL fix, the live 502 was gone and the next thing operators
 * hit was `409 ALREADY_REDEEMED` on the very code they had just connected with.
 * The bridge worked; the console was the bug. Verify hard-failed on a redeemed
 * code, so the "Confirm & connect" control never rendered and the only available
 * next step was minting a new code in the POS — even for the listing's own
 * previous connection, which the sibling claim route would have accepted
 * idempotently.
 *
 * A redeemed code is the one failure that is NOT decidable during verify: the POS
 * returns the bare code with no bound identity there, so "reconnect" and "replay
 * against a different POS restaurant" look identical. These pin that it is
 * classified as its own recoverable outcome rather than an error status, and that
 * the genuinely fatal cases still are.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { PosBridgeError, classifyPosVerifyFailure } from "../src/lib/pos-bridge";

test("a redeemed code is recoverable, not a fatal verify error", () => {
  const outcome = classifyPosVerifyFailure(
    new PosBridgeError("ALREADY_REDEEMED", 409, "ALREADY_REDEEMED"),
  );

  assert.equal(outcome.kind, "redeemed");
  // The route maps this to 200 so the console can still offer the claim step.
  assert.ok(!("status" in outcome), "must not carry an error status");
  assert.match(outcome.kind === "redeemed" ? outcome.message : "", /already been used/i);
});

test("the redeemed message tells the operator how to proceed either way", () => {
  const outcome = classifyPosVerifyFailure(
    new PosBridgeError("ALREADY_REDEEMED", 409, "ALREADY_REDEEMED"),
  );
  const message = outcome.kind === "redeemed" ? outcome.message : "";

  // Both branches must be named, otherwise the operator cannot tell a harmless
  // reconnect from a code they should stop using.
  assert.match(message, /reconnect/i);
  assert.match(message, /new one in the POS/i);
});

test("an invalid or expired code stays fatal at 401", () => {
  const outcome = classifyPosVerifyFailure(new PosBridgeError("INVALID_CODE", 401, "INVALID_CODE"));

  assert.equal(outcome.kind, "fatal");
  assert.equal(outcome.kind === "fatal" ? outcome.status : 0, 401);
  assert.equal(outcome.kind === "fatal" ? outcome.message : "", "Code is invalid or has expired");
});

test("transport failures stay fatal and retryable, never redeemed", () => {
  for (const status of [502, 503]) {
    const outcome = classifyPosVerifyFailure(
      new PosBridgeError("POS is unreachable", status, "POS_UNREACHABLE"),
    );

    assert.equal(outcome.kind, "fatal");
    assert.equal(outcome.kind === "fatal" ? outcome.status : 0, status);
    assert.match(outcome.kind === "fatal" ? outcome.message : "", /unreachable/i);
  }
});

test("a 409 that is not a redemption is not mistaken for one", () => {
  // The claim route has a distinct 409 (MARKETPLACE_ID_TAKEN). Verify must not
  // swallow a future 409 into the "continue" affordance.
  const outcome = classifyPosVerifyFailure(
    new PosBridgeError("already connected elsewhere", 409, "MARKETPLACE_ID_TAKEN"),
  );

  assert.equal(outcome.kind, "fatal");
  assert.equal(outcome.kind === "fatal" ? outcome.status : 0, 409);
});

test("an unmatched POS failure never echoes the remote's wording back to a client", () => {
  // Everything the classifier maps explicitly (401, 502, 503) already has fixed
  // copy. The fall-through used to return `err.message`, which is text the POS
  // chose, travelling to whoever holds a partner session. The status and code
  // carry the diagnosis; the wording does not.
  const remoteSaid = "connect to 10.0.0.7 with token sk-live-abc";
  const outcome = classifyPosVerifyFailure(new PosBridgeError(remoteSaid, 418, "TEAPOT"));

  assert.equal(outcome.kind, "fatal");
  assert.equal(outcome.kind === "fatal" ? outcome.message : "", "The POS rejected the connection code");
  assert.equal(outcome.kind === "fatal" ? outcome.code : "", "TEAPOT");
  assert.equal(outcome.kind === "fatal" ? outcome.status : 0, 418);
});

test("a non-bridge error is reported as a 500 rather than crashing", () => {
  const outcome = classifyPosVerifyFailure(new Error("boom"));

  assert.equal(outcome.kind, "fatal");
  assert.equal(outcome.kind === "fatal" ? outcome.status : 0, 500);
  assert.equal(outcome.kind === "fatal" ? outcome.message : "", "Could not verify the code");
});
