/**
 * Tests for what an UNAUTHENTICATED caller is told about their own failure.
 *
 * Run with: npm test
 *
 * Two disclosures were reachable from the request side:
 *
 *   - `_diag: { signatureValid, timestampValid, restaurantValid }` was echoed on
 *     the 401/403 webhook refusals. Those bodies go back to a caller who has
 *     proved nothing, and the three booleans say which check to work on next —
 *     a free oracle for probing signatures, timestamps and tenant ids. The
 *     verified branches keep `_diag`; only the refusals lose it.
 *   - `PosConnectionIdentity.webhook_secret` is documented as never echoed back
 *     to clients, and the `/api/partner/integrations/verify` response was the
 *     one path that returned the attestation verbatim.
 *
 * The routes import `server-only` and the database, so — like
 * `order-checkout-validation.test.ts` — what is asserted here is the source the
 * way `abuse-guards.test.ts` does: the guarantee must be in the shipped file,
 * not in a reviewer's memory.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/* ------------------------- webhook refusals ------------------------------ */

test("the order-status webhook tells an unverified caller nothing about the checks", () => {
  const source = readSource("src/lib/pos-order-status-webhook.ts");
  // Everything up to the first parsed body is pre-verification: the unknown
  // tenant refusal (403) and the bad signature / stale timestamp refusal (401).
  const parseAt = source.indexOf("const body = parseBody(rawBody);");
  assert.ok(parseAt > 0, "the parse site anchors this slice");
  assert.doesNotMatch(
    source.slice(0, parseAt),
    /_diag\s*:/,
    "a refusal must not report which check failed",
  );
  // The dedupe / skip / applied responses keep theirs — by then the caller has
  // already proved the secret.
  assert.match(source, /_diag: diag/);
});

test("the menu-item webhook drops _diag from the unverified branch only", () => {
  const source = readSource("src/app/api/integrations/webhooks/menu-item/route.ts");
  const start = source.indexOf("if (!verified) {");
  assert.ok(start >= 0, "the unverified branch is the one that matters");
  const end = source.indexOf("if (!body) {", start);
  assert.ok(end > start, "the refusal block is followed by the body check");
  const refusal = source.slice(start, end);
  assert.doesNotMatch(refusal, /_diag\s*:/, "a refusal must not report which check failed");
  // The dedupe and success responses still carry it — the caller already held
  // the secret by then.
  assert.match(source, /_diag: diag/);
});

/* --------------------------- verify attestation -------------------------- */

test("the verify route strips the webhook secret out of the attestation", () => {
  const source = readSource("src/app/api/partner/integrations/verify/route.ts");
  assert.match(source, /delete safe\.webhook_secret/, "the secret must be dropped, not trusted to be absent");
  assert.match(source, /Response\.json\(\{ ok: true, detected: safe \}\)/);
  assert.doesNotMatch(
    source,
    /Response\.json\(\{ ok: true, detected \}\)/,
    "returning the raw attestation re-exports a secret the doc says never leaves the server",
  );
});

/* --------------------------- partner bridge errors ----------------------- */

test("no bridge failure hands the remote's wording to a client", () => {
  const bridge = readSource("src/lib/pos-bridge.ts");
  const classifier = bridge.slice(
    bridge.indexOf("export function classifyPosVerifyFailure"),
    bridge.indexOf("export async function verifyPosConnection"),
  );
  assert.doesNotMatch(
    classifier,
    /message: err\.message/,
    "the POS chose that string; the client must not receive it",
  );

  const claim = readSource("src/app/api/partner/integrations/route.ts");
  assert.doesNotMatch(
    claim,
    /: err\.message;/,
    "the fall-through must map to fixed copy the way 401/409/502 already do",
  );
});
