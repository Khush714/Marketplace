import { NextRequest } from "next/server";
import { getIntegrationSession } from "@/db/queries";
import type { RestaurantDto } from "@/lib/types";

/** Extract the raw Bearer token, or "" when the header is absent/malformed. */
export function parseBearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

/** Resolves the caller's Bearer integration token to their restaurant, or null. */
export async function requireIntegrationAuth(req: NextRequest): Promise<RestaurantDto | null> {
  const token = parseBearerToken(req);
  if (!token) return null;
  return getIntegrationSession(token);
}