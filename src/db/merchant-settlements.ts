import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { marketplacePayments, orders } from "@/db/schema";
import {
  MERCHANT_SETTLEMENT_PAGE_SIZE,
  normalizeMerchantSettlementPage,
  toMerchantSettlement,
  type MerchantSettlementRecord,
} from "@/lib/merchant-settlements";

export const MERCHANT_SETTLEMENT_LIMIT = MERCHANT_SETTLEMENT_PAGE_SIZE;

export type MerchantSettlementPage = {
  settlements: MerchantSettlementRecord[];
  page: number;
  hasMore: boolean;
};

/** Money settled for one Marketplace listing. Tenant scope comes from the paired restaurant, never the caller. */
export async function listMerchantSettlements(restaurantId: number, options: { page?: number | string | null } = {}): Promise<MerchantSettlementPage> {
  const page = normalizeMerchantSettlementPage(options.page);
  const rows = await db
    .select({ payment: marketplacePayments, order: orders })
    .from(marketplacePayments)
    .innerJoin(orders, eq(marketplacePayments.marketplaceOrderId, orders.id))
    .where(and(eq(marketplacePayments.restaurantId, restaurantId), eq(orders.restaurantId, restaurantId)))
    .orderBy(desc(marketplacePayments.updatedAt))
    .limit(MERCHANT_SETTLEMENT_LIMIT + 1)
    .offset((page - 1) * MERCHANT_SETTLEMENT_LIMIT);

  const hasMore = rows.length > MERCHANT_SETTLEMENT_LIMIT;
  return {
    page,
    hasMore,
    settlements: rows.slice(0, MERCHANT_SETTLEMENT_LIMIT).map(({ payment, order }) => toMerchantSettlement({
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
    })),
  };
}
