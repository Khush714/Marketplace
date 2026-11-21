import "server-only";

import type { NextRequest } from "next/server";
import { requireOpsToken as requireOpsTokenBase } from "@/lib/ops-auth";

/**
 * Require an ops/admin token. Delegates to the existing implementation to
 * avoid duplicating the auth policy. Returns null if authorized, otherwise a
 * Response object (as returned by requireOpsToken).
 */
export function requireAdmin(req: NextRequest): Response | null {
  return requireOpsTokenBase(req);
}