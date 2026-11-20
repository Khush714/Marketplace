import { NextRequest } from "next/server";
import { getPayoutAccount, savePayoutAccount } from "@/db/merchant-compliance";
import { guardBudget, readJsonBody } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import {
  MerchantComplianceInputError,
  normalizePayoutInput,
  notConfiguredPayout,
  payoutDto,
} from "@/lib/merchant-compliance";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } } as const;

function invalid(message: string): Response {
  return Response.json({ ok: false, error: message }, { status: 400 });
}

/** Payout status for the paired listing. Real destination data never leaves Marketplace. */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const row = await getPayoutAccount(auth.restaurantId);
  const payout = row ? payoutDto(row) : notConfiguredPayout();
  return Response.json({ ok: true, payout }, NO_STORE);
}

/** Forward a UPI/bank destination to Marketplace; Merchant keeps only a masked label. */
export async function POST(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceWrite");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  try {
    const input = normalizePayoutInput(parsed.body);
    const payout = await savePayoutAccount(auth.restaurantId, input);
    return Response.json({ ok: true, payout }, NO_STORE);
  } catch (error) {
    if (error instanceof MerchantComplianceInputError) return invalid(error.message);
    throw error;
  }
}
