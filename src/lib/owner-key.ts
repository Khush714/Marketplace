import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Server-generated ownership secret, returned to a restaurant exactly once. */
export function makeOwnerKey(): string {
  return randomBytes(18).toString("base64url");
}

export function hashOwnerKey(ownerKey: string): string {
  return sha256hex(ownerKey);
}

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Server-generated access token for a restaurant's integration session. */
export function makeAccessToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Server-generated canonical marketplace ID for a restaurant listing (rst_…). */
export function makeMarketplaceId(): string {
  return `rst_${randomBytes(12).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return sha256hex(token);
}

/**
 * Constant-time compare for ownership checks.
 *
 * Both sides are SHA-256 digests, so a bytewise compare is already only a
 * theoretical leak — but `Buffer.compare` returns on the first differing byte,
 * and this is an authentication path. `timingSafeEqual` is the same cost and
 * removes the argument.
 */
export function ownerKeyMatches(hash: string | null, ownerKey: string): boolean {
  if (!hash) return false;
  const a = Buffer.from(hash);
  const b = Buffer.from(hashOwnerKey(ownerKey));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Match a POS login passkey against the right hash.
 *
 * `integrationPasskeyHash` is the POS credential. When it is NULL the listing
 * predates the split (or was ops-provisioned) and its owner key is still the
 * shared secret, so it is the fallback. Once the split column is populated it
 * SHADOWS the owner key — that is what makes rotation actually revoke the old
 * passkey, and what stops a rotated integration from being re-authenticated
 * with the key the restaurant holds in its browser.
 */
export function integrationPasskeyMatches(
  hashes: { ownerKeyHash: string | null; integrationPasskeyHash: string | null },
  passkey: string,
): boolean {
  const hash = hashes.integrationPasskeyHash ?? hashes.ownerKeyHash;
  return ownerKeyMatches(hash, passkey);
}
