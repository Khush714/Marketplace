import "server-only";
import { createHash, randomBytes } from "node:crypto";

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

export function hashToken(token: string): string {
  return sha256hex(token);
}

/** Constant-time-ish compare for ownership checks. */
export function ownerKeyMatches(hash: string | null, ownerKey: string): boolean {
  if (!hash) return false;
  const a = Buffer.from(hash);
  const b = Buffer.from(hashOwnerKey(ownerKey));
  return a.length === b.length && Buffer.compare(a, b) === 0;
}