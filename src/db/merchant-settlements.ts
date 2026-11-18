import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { marketplacePayments, orders } from "@/db/schema";
import { toMerchantSettlement, type MerchantSettlementRecord } from "@/lib/merchant-settlements";

/** Merchant's parser rejects oversized feeds, so cap the authoritative query at the same boundary. */
export const MERCHANT_SETTLEMENT_LIMIT = 200;

/** Money settled for one Marketplace listing. Tenant scope comes from the paired restaurant, never the caller. */
export async function listMerchantSettlements(restaurantId: number): Promise<MerchantSettlementRecord[]> {
  const rows = await db
    .select({ payment: marketplacePayments, order: orders })
    .from(marketplacePayments)
    .innerJoin(orders, eq(marketplacePayments.marketplaceOrderId, orders.id))
    .where(and(eq(marketplacePayments.restaurantId, restaurantId), eq(orders.restaurantId, restaurantId)))
    .orderBy(desc(marketplacePayments.updatedAt))
    .limit(MERCHANT_SETTLEMENT_LIMIT);

  return rows.map(({ payment, order }) => toMerchantSettlement({
    paymentReference: payment.paymentReference,
    providerPaymentId: payment.providerPaymentId,
    currency: payment.currency,
    status: payment.status,
    signatureVerified: payment.signatureVerified,
    amountCents: payment.amountCents,
    refundedAmountCents: payment.refundedAmountCents,
    capturedAt: payment.capturedAt,
    updatedAt: payment.updatedAt,
    order: {
      id: order.id,
      code: order.code,
      platformFeeCents: order.platformFeeCents,
    },
  }));
}
