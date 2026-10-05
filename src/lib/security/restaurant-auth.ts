import "server-only";

import type { NextRequest } from "next/server";

import { hashOwnerKey, ownerKeyMatches } from "@/lib/owner-key";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { integrationPasskeyMatches } from "@/lib/owner-key";

/** Header names accepted for the owner key. */
export const OWNER_KEY_HEADERS = ["x-owner-key", "x-restaurant-key"] as const;

/**
 * Extract the owner key presented by the partner console.
 * The key is delivered via a header (never the query string). We accept either
 * of the historical header names to avoid breaking older clients.
 */
export function extractOwnerKey(req: NextRequest): string | null {
  for (const header of OWNER_KEY_HEADERS) {
    const v = req.headers.get(header);
    if (v && v.length > 0) return v;
  }
  return null;
}

/**
 * Verify an owner key against the hash stored on a restaurant and return the
 * restaurant id if it matches. Returns null if the key is invalid, the hash is
 * missing, or the restaurant is not found.
 */
export async function verifyOwnerKey(restaurantId: number, ownerKey: string): Promise<boolean> {
  const [r] = await db
    .select({ ownerKeyHash: restaurants.ownerKeyHash })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!r) return false;
  return ownerKeyMatches(r.ownerKeyHash, ownerKey);
}

/** Result of an owner-key auth check against a restaurant. */
export type OwnerKeyAuthResult =
  | { ok: true; restaurantId: number }
  | { ok: false; status: 401 | 404; error: string };

/**
 * Require the owner key to match the given restaurant. This centralises the
 * status codes: missing key → 401, restaurant not found → 404, wrong key → 401.
 */
export async function requireOwnerKeyForRestaurant(
  req: NextRequest,
  restaurantId: number,
): Promise<OwnerKeyAuthResult> {
  const key = extractOwnerKey(req);
  if (!key) {
    return { ok: false, status: 401, error: "Missing owner key" };
  }
  const [r] = await db
    .select({ ownerKeyHash: restaurants.ownerKeyHash })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!r) return { ok: false, status: 404, error: "Restaurant not found" };
  if (!ownerKeyMatches(r.ownerKeyHash, key)) {
    return { ok: false, status: 401, error: "Invalid owner key" };
  }
  return { ok: true, restaurantId };
}