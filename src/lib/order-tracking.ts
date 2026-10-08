import { createHash, randomBytes } from "node:crypto";

/**
 * Phase 6 — the order's bearer tracking credential.
 *
 * Customer tracking today is authenticated by a per-order HMAC token minted at
 * checkout and kept beside the code in the browser's profile (lib/order-token).
 * That is fine for the browser that placed the order but breaks the moment the
 * customer wants to watch it from another device: the token lives in
 * localStorage, not the URL.
 *
 * Every new order is therefore also minted a 128-bit random tracking token, and
 * the customer URL becomes `/order/<tracking-token>`. The token is a bearer
 * credential sitting in the open — anyone holding it can track the order, like
 * a delivery link or an event wristband — so it must not be derivable from the
 * public `CRV-XXXXX` code. Hence:
 *
 *   - it is 16 CSPRNG bytes (22 base64url chars), not a guessable short code;
 *   - only its sha256 hash is ever persisted, so a database leak does not hand
 *     out working tracking URLs and the plaintext is returned to the browser
 *     exactly once, at checkout;
 *   - lookups validate the format before hashing, so junk never reaches a query.
 *
 * The HMAC path (code + token header) stays for pre-existing orders, payment,
 * cancellation and history; the tracking token is additive on top of it.
 */

/** 128 bits of entropy, fixed deliberately rather than tuned per route. */
export const TRACKING_TOKEN_BYTES = 16;

/** Mint a fresh tracking token: 16 bytes, base64url, no padding. */
export function makeTrackingToken(): string {
  return randomBytes(TRACKING_TOKEN_BYTES).toString("base64url");
}

/** The 64-hex digest stored on the order row. The raw token is never stored. */
export function hashTrackingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 16 bytes in base64url is exactly 22 characters of `[A-Za-z0-9_-]`. */
const TRACKING_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Cheap shape check before a token is hashed and looked up. Rejects anything
 * that could not be a minted token — short codes, `CRV-XXXXX`, padded base64,
 * URL-hostile characters — so a wrong URL dies as a 404 with no query at all.
 */
export function isTrackingToken(token: string): boolean {
  return TRACKING_TOKEN_RE.test(token);
}