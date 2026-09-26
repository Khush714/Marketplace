import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationRecords } from "@/db/schema";

export type OutletResolution =
  | {
      ok: true;
      claimedOutletId: string | null;
      storedOutletId: string | null;
      storedBranchId: string | null;
    }
  | { ok: false; code: "INTEGRATION_NOT_CONNECTED" | "OUTLET_NOT_MAPPED" };

export const OUTLET_ERROR_MESSAGES: Record<string, string> = {
  INTEGRATION_NOT_CONNECTED: "This restaurant is not connected to the POS",
  OUTLET_NOT_MAPPED: "This outlet is not available for this restaurant",
};

/**
 * Resolve a client-claimed outlet against the restaurant's POS integration
 * record. Deterministic, tenant-scoped, fail-closed — only stable codes escape:
 *   - no ACTIVE record            → INTEGRATION_NOT_CONNECTED
 *   - claim with no matching outlet → OUTLET_NOT_MAPPED (never silently fall
 *     back to the restaurant-level row — a mistyped/foreign outlet is a hard
 *     rejection, the POS enforces the same rule at ingest time)
 *   - no claim                     → legacy store-level routing (branch/outlet
 *     may be null and are filled by the delivery path from the record).
 */
export async function resolveOutletForRestaurant(
  restaurantId: number,
  outletClaim: string | null | undefined,
): Promise<OutletResolution> {
  const [record] = await db
    .select({
      status: integrationRecords.status,
      posOutletId: integrationRecords.posOutletId,
      posBranchId: integrationRecords.posBranchId,
    })
    .from(integrationRecords)
    .where(eq(integrationRecords.restaurantId, restaurantId))
    .limit(1);

  if (!record || record.status !== "active") {
    return { ok: false, code: "INTEGRATION_NOT_CONNECTED" };
  }

  const claimed = String(outletClaim ?? "").trim() || null;
  if (claimed) {
    if (!record.posOutletId || record.posOutletId !== claimed) {
      return { ok: false, code: "OUTLET_NOT_MAPPED" };
    }
    return {
      ok: true,
      claimedOutletId: claimed,
      storedOutletId: record.posOutletId,
      storedBranchId: record.posBranchId,
    };
  }

  return {
    ok: true,
    claimedOutletId: null,
    storedOutletId: record.posOutletId,
    storedBranchId: record.posBranchId,
  };
}