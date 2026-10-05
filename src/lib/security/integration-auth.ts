import "server-only";

import type { NextRequest } from "next/server";
import { db } from "@/db";
import { restaurants } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashToken, makeAccessToken, ownerKeyMatches } from "@/lib/owner-key";

/** Hash an integration access token. */
export function hashAccessToken(token: string): string {
  return hashToken(token);
}

/**
 * Simple in-memory integration session store for the server runtime.
 * Sessions are stored as { restaurantId, expiresAtMs } keyed by the token hash.
 * This mirrors the expectations of existing routes (e.g. /api/integration/login
 * returns a token; /api/integration/* routes validate it). We keep it simple and
 * server-only; for multi-instance deployments a shared store would be needed.
 */
const sessions = new Map<string, { restaurantId: number; expiresAtMs: number }>();

function getToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") || req.headers.get("x-integration-token");
  if (!h) return null;
  const v = h.trim();
  if (v.toLowerCase().startsWith("bearer ")) return v.slice(7).trim();
  return v;
}

/** Invalidate all integration sessions for a restaurant. */
export function revokeIntegrationSessionsForRestaurant(restaurantId: number): void {
  for (const [k, s] of sessions) {
    if (s.restaurantId === restaurantId) sessions.delete(k);
  }
}

/** Issue a new integration session token for a restaurant (stores hashed). */
export function issueIntegrationSession(restaurantId: number, ttlMs: number): string {
  const token = makeAccessToken();
  const h = hashAccessToken(token);
  const expiresAtMs = Date.now() + ttlMs;
  sessions.set(h, { restaurantId, expiresAtMs });
  return token;
}

/** Verify integration session and return restaurantId if valid. */
export async function verifyIntegrationSession(req: NextRequest): Promise<number | null> {
  const token = getToken(req);
  if (!token) return null;
  const h = hashAccessToken(token);
  const s = sessions.get(h);
  if (!s) return null;
  if (s.expiresAtMs < Date.now()) {
    sessions.delete(h);
    return null;
  }
  return s.restaurantId;
}

/** Require a valid integration session; returns 401 if missing/invalid. */
export async function requireIntegrationSession(req: NextRequest): Promise<{ ok: true; restaurantId: number } | { ok: false; status: 401; error: string }> {
  const rid = await verifyIntegrationSession(req);
  if (rid == null) return { ok: false, status: 401, error: "Invalid or missing integration token" };
  return { ok: true, restaurantId: rid };
}