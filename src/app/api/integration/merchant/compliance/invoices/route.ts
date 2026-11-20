import { NextRequest } from "next/server";
import { listComplianceInvoices } from "@/db/merchant-compliance";
import { guardBudget } from "@/lib/abuse";
import { authenticateMerchantApp, unauthenticatedMerchantApp } from "@/lib/merchant-app-auth";
import {
  MerchantRevenueRangeError,
  normalizeMerchantRevenueRange,
} from "@/lib/merchant-revenue";

export const dynamic = "force-dynamic";

/** Payment-derived invoice feed for the paired listing, at most 500 rows. */
export async function GET(req: NextRequest) {
  const blocked = guardBudget(req, "merchantServiceRead");
  if (blocked) return blocked;
  const auth = await authenticateMerchantApp(req);
  if (!auth) return unauthenticatedMerchantApp();
  try {
    const range = normalizeMerchantRevenueRange(
      req.nextUrl.searchParams.get("from"),
      req.nextUrl.searchParams.get("to"),
    );
    const invoices = await listComplianceInvoices(auth.restaurantId, range);
    return Response.json({ ok: true, invoices }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MerchantRevenueRangeError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    throw error;
  }
}
