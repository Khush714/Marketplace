import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { marketplaceProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * PHASE 12 — POS bridge credentials.
 *
 * Each restaurant's POS system authenticates with a per-restaurant key so it
 * can poll for and act on marketplace orders without exposing customer session
 * auth. We only ever store a SHA-256 hash; the plaintext key is shown once
 * (in the POS onboarding screen) and never logged.
 */

export function generatePosKey(): { key: string; hash: string } {
  const key = `pos_${randomBytes(16).toString("hex")}`;
  return { key, hash: hashPosKey(key) };
}

export function hashPosKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function verifyPosKey(hash: string, key: string): boolean {
  if (!hash || !key) return false;
  const candidate = hashPosKey(key);
  // Constant-time comparison.
  const a = Buffer.from(candidate);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function getPosKeyHash(restaurantId: number): Promise<string> {
  const [p] = await db
    .select({ hash: marketplaceProfiles.posKeyHash })
    .from(marketplaceProfiles)
    .where(eq(marketplaceProfiles.restaurantId, restaurantId))
    .limit(1);
  return p?.hash ?? "";
}

export async function rotatePosKey(restaurantId: number): Promise<string> {
  const { key, hash } = generatePosKey();
  await db
    .update(marketplaceProfiles)
    .set({ posKeyHash: hash })
    .where(eq(marketplaceProfiles.restaurantId, restaurantId));
  return key;
}

/**
 * Resolve the restaurant that owns the given POS key, or null. Used by every
 * POS route to scope the request to a single tenant.
 */
export async function restaurantForPosKey(key: string): Promise<number | null> {
  if (!key) return null;
  const hash = hashPosKey(key);
  const [p] = await db
    .select({ restaurantId: marketplaceProfiles.restaurantId })
    .from(marketplaceProfiles)
    .where(eq(marketplaceProfiles.posKeyHash, hash))
    .limit(1);
  return p?.restaurantId ?? null;
}
