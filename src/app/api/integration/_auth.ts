import { NextRequest } from "next/server";
import { getIntegrationSession } from "@/db/queries";
import type { RestaurantDto } from "@/lib/types";

/** Resolves the caller's Bearer integration token to their restaurant, or null. */
export async function requireIntegrationAuth(req: NextRequest): Promise<RestaurantDto | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  return getIntegrationSession(token);
}