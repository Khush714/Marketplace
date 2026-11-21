import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationRecords } from "@/db/schema";
import { canDeliverToPos } from "@/integrations/pos/readiness";

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
 *   - no deliverable record         → INTEGRATION_NOT_CONNECTED
 *   - claim with no matching outlet → OUTLET_NOT_MAPPED (never silently fall
 *     back to the restaurant-level row — a mistyped/foreign outlet is a hard
 *     rejection, the POS enforces the same rule at ingest time)
 *   - no claim                     → legacy store-level routing (branch/outlet
 *     may be null and are filled by the delivery path from the record).
 *
 * "Deliverable" is the same three facts `notReadyReason` in the order bridge
 * and `hasActiveIntegration` in the db layer require: ACTIVE, a POS restaurant id
 * to route on, and a sealed webhook secret to sign with. Treating a bare
 * `status = 'active'` as connected let a half-claimed integration accept an
 * order it had no way to deliver.
 */
export async function resolveOutletForRestaurant(
  restaurantId: number,
  outletClaim: string | null | undefined,
): Promise<OutletResolution> {
  const [record] = await db
    .select({
      status: integrationRecords.status,
      posRestaurantId: integrationRecords.posRestaurantId,
      posOutletId: integrationRecords.posOutletId,
      posBranchId: integrationRecords.posBranchId,
      webhookSecret: integrationRecords.webhookSecret,
    })
    .from(integrationRecords)
    .where(eq(integrationRecords.restaurantId, restaurantId))
    .limit(1);

  // Deliberately the shared predicate rather than a fourth inline copy of
  // "ACTIVE and routable and signable" — see readiness.ts for why these copies
  // used to disagree.
  if (!record || !canDeliverToPos(record)) {
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