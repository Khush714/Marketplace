import { NextRequest } from "next/server";

import { approvePayoutBatch } from "@/db/merchant-payouts";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import {
  normalizePayoutChecksum,
  normalizePayoutReference,
  PayoutConflictError,
  PayoutInputError,
  PayoutNotFoundError,
} from "@/lib/payout-core";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } } as const;

type ApproveContext = { params: Promise<{ reference: string }> };

/**
 * Human approval gate. The submitted checksum forces the caller to show the
 * exact snapshot it approved; Marketplace reprices it before queueing a durable
 * outbox intent. No bank-transfer provider is invoked.
 */
export async function POST(req: NextRequest, context: ApproveContext) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as Record<string, unknown>;

  try {
    const { reference: rawReference } = await context.params;
    const reference = normalizePayoutReference(rawReference);
    const checksum = normalizePayoutChecksum(body.checksum);
    const batch = await approvePayoutBatch(auth.restaurantId, reference, checksum);
    return Response.json({ ok: true, batch }, NO_STORE);
  } catch (error) {
    if (error instanceof PayoutInputError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof PayoutConflictError) {
      return Response.json({ ok: false, error: error.message }, { status: 409 });
    }
    if (error instanceof PayoutNotFoundError) {
      return Response.json({ ok: false, error: error.message }, { status: 404 });
    }
    throw error;
  }
}
