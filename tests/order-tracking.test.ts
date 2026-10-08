/**
 * Tests for the Phase 6 order tracking token and its wiring.
 *
 * Run with: npm test
 *
 * The tracking token is a bearer credential that lives in a shareable URL
 * (`/order/<tracking-token>`), so unlike every other secret in this app its
 * whole job is to survive exposure to strangers and logs. That shapes the
 * contract pinned here:
 *
 *   - Geometry and entropy: 16 CSPRNG bytes (22 base64url chars) is the floor
 *     for something a customer forwards to a second device. Anything less and
 *     an enumeration attack on the URL space becomes plausible.
 *   - Only the sha256 hash is persisted: a database leak must not hand out
 *     working tracking links, and the plaintext is returned exactly once, at
 *     checkout. The idempotent retry path therefore has no token to return.
 *   - Shape is validated before hashing: `CRV-XXXXX`, short codes and padded
 *     base64 die as 404s without touching the database at all.
 *   - Routes are actually wired: minting happens once in `createOrder`, the
 *     checkout response passes it through, the track route is read-gated and
 *     projects through `toPublicOrder`, and the browser keeps it beside the
 *     code+HMAC pair it already stores.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TRACKING_TOKEN_BYTES,
  hashTrackingToken,
  isTrackingToken,
  makeTrackingToken,
} from "../src/lib/order-tracking";

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/* ------------------------------- geometry ---------------------------------- */

test("the token is 16 bytes and exactly 22 base64url characters", () => {
  assert.equal(TRACKING_TOKEN_BYTES, 16);
  const token = makeTrackingToken();
  assert.equal(token.length, 22, "16 bytes in base64url is 22 chars with no padding");
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  const decoded = Buffer.from(token, "base64url");
  assert.equal(decoded.length, 16, "the token decodes back to exactly 128 bits");
});

test("minted tokens are unique per call", () => {
  const a = makeTrackingToken();
  const b = makeTrackingToken();
  assert.equal(a.length, 22);
  assert.notEqual(a, b);
});

/* --------------------------------- hashing --------------------------------- */

test("hashTrackingToken is the sha256 hex digest, deterministic", () => {
  const token = makeTrackingToken();
  const expected = createHash("sha256").update(token).digest("hex");
  assert.equal(hashTrackingToken(token), expected);
  assert.equal(hashTrackingToken(token), hashTrackingToken(token), "same input, same digest");
  assert.match(hashTrackingToken(token), /^[0-9a-f]{64}$/);
  // A one-bit change flips the hash: two different tokens can never collide in
  // practice and url-encoded variants must not be treated as the same order.
  assert.notEqual(hashTrackingToken(token), hashTrackingToken(token.replace(/./, (c) => (c === "a" ? "b" : "a"))));
});

/* ---------------------------------- shape ---------------------------------- */

test("isTrackingToken accepts freshly minted tokens", () => {
  assert.equal(isTrackingToken(makeTrackingToken()), true);
});

test("isTrackingToken rejects anything that is not a 22-char base64url token", () => {
  for (const bad of [
    "CRV-ABC12",
    "CRV-54321",
    "short",
    "x".repeat(21),
    "x".repeat(23),
    "xxxxxxxxxxxxxxxxxxxxxx!", // non-base64url char
    "xxxxxxxxxxxxxxxxxxxxx=", // padded base64 — padding is never produced
    "",
  ]) {
    assert.equal(isTrackingToken(bad), false, `should reject: ${bad}`);
  }
});

test("isTrackingToken is a shape check only — a well-formed-but-unknown token passes", () => {
  // A minted token is 22 base64url chars; so is an unminted string with that
  // shape. isTrackingToken must not reject it: there is no registry to consult
  // client-side, and the route lets the hash lookup decide existence as a 404.
  assert.equal(isTrackingToken("g".repeat(22)), true);
});

/* -------------------------------- wiring ----------------------------------- */

test("createOrder mints the token once, stores only its hash, returns the plaintext on the fresh path", () => {
  const source = readSource("src/db/queries.ts");
  assert.match(source, /import \{ hashTrackingToken, makeTrackingToken \} from "@\/lib\/order-tracking"/);
  assert.match(source, /const trackingToken = makeTrackingToken\(\)/, "minted exactly once, at creation");
  assert.match(source, /trackingTokenHash: hashTrackingToken\(trackingToken\)/, "only the hash is persisted");
  assert.match(source, /return \{ ok: true, order: toOrderDto\(created\), trackingToken \};/, "fresh path returns the plaintext");
  assert.match(source, /trackingToken\?: string/, "the result type says the token is optional");
});

test("the idempotent retry path returns no tracking token", () => {
  const source = readSource("src/db/queries.ts");
  // A lost-response retry only has the hash on disk, never the plaintext — so
  // the retry omits it and the browser keeps code+HMAC for that order.
  assert.match(source, /if \(existing\) return \{ ok: true, order: toOrderDto\(existing\) \};/);
  assert.doesNotMatch(source, /if \(existing\) return \{ ok: true, order: toOrderDto\(existing\), trackingToken/);
});

test("the checkout route passes the tracking token through its response", () => {
  const source = readSource("src/app/api/orders/route.ts");
  assert.match(source, /\.\.\.result,/, "the createOrder result is spread wholesale onto the response");
  assert.match(source, /trackingToken/, "the spread carries the minted token to the browser");
});

test("the track route is shape-gated, read-throttled and projected to the public order", () => {
  const source = readSource("src/app/api/orders/track/[trackingToken]/route.ts");
  assert.match(source, /isTrackingToken\(trackingToken\)/, "format is checked before any query");
  assert.match(source, /\{ error: "Not found" \}, \{ status: 404 \}/, "malformed URLs die as 404");
  assert.match(source, /guardRead\(req, "orderLookup"\)/, "the endpoint sits behind the read guard");
  assert.match(source, /getOrderByTrackingToken\(trackingToken\)/, "lookup goes through the tracking-token accessor");
  assert.match(source, /toPublicOrder\(order\)/, "only the customer-safe projection is returned");
});

test("the accessor hashes before querying so the raw token never reads the database", () => {
  const source = readSource("src/db/queries.ts");
  assert.match(source, /where\(eq\(orders.trackingTokenHash, hashTrackingToken\(token\)\)\)/, "the query is on the hash, never the token");
});

test("the browser accessor calls the token-authenticated endpoint", () => {
  const source = readSource("src/lib/order-access.ts");
  assert.match(source, /fetch\(`\/api\/orders\/track\/\$\{encodeURIComponent\(trackingToken\)\}`/, "client fetches the token route");
});

test("the profile keeps the tracking token beside the code+HMAC pair", () => {
  const source = readSource("src/lib/profile.tsx");
  assert.match(source, /rememberOrder: \(code: string, token: string, trackingToken\?: string\) => void/, "three-argument signature exposed");
  assert.match(source, /\{ code: clean, token, \.\.\.\(trackingToken \? \{ trackingToken \} : \{\}\), at: Date\.now\(\) \}/, "the token is stored on the order slot");
  assert.match(source, /trackingToken\?: string;/, "StoredOrder carries it");
});

test("checkout stores and uses the tracking token in its post-order UI", () => {
  const source = readSource("src/app/checkout/page.tsx");
  assert.match(source, /profile\.rememberOrder\(code, token, trackingToken \?\? undefined\)/, "checkout persists the token");
  assert.match(source, /trackingToken: trackingToken \?\? undefined/, "the placed-order panel is told about it");
  assert.match(source, /placed\.trackingToken/, "the panel chooses the token URL when it is present");
});

test("the success and history screens prefer the shareable tracking URL", () => {
  const success = readSource("src/components/order-success-screen.tsx");
  assert.match(success, /trackingHref = stored\?\.trackingToken/, "derived from the stored profile token");
  assert.match(success, /`\/order\/\$\{code\}\/track`/, "falling back to the code+token page");

  const orders = readSource("src/app/orders/page.tsx");
  assert.match(orders, /trackingHref = storedToken \? `\/order\/track\/\$\{storedToken\}` : `\/order\/\$\{o\.code\}\/track`/, "history links use the token when on file");

  const panel = readSource("src/components/order-success.tsx");
  assert.match(panel, /trackingHref: string;/, "the success panel renders a caller-supplied href");
  assert.doesNotMatch(panel, /href=\{`\/order\/\$\{order\.code\}\/track`\}/, "no hardcoded code+token link remains");
});