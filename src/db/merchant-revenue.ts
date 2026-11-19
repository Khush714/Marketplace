import "server-only";

import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketplacePayments, orders } from "@/db/schema";
import {
  merchantRevenueDto,
  type MerchantRevenueRange,
  type MerchantRevenueSummary,
} from "@/lib/merchant-revenue";

/**
 * Statuses mapped to a confirmed payout by `merchantSettlementStatus`. A refund
 * still counts as paid money: its refunded amount is subtracted from the net.
 */
const PAID_PAYMENT_STATUSES = ["PAID", "CAPTURED", "PARTIALLY_REFUNDED", "REFUND_PENDING"];

/** Marketplace-owned revenue, scoped entirely by the token's restaurant id. */
export async function getMerchantRevenue(
  restaurantId: number,
  range: MerchantRevenueRange,
): Promise<MerchantRevenueSummary> {
  const orderFilters = [
    eq(orders.restaurantId, restaurantId),
    eq(orders.merchantManaged, true),
    inArray(orders.merchantStatus, ["COMPLETED", "DELIVERED"]),
    or(eq(orders.paymentMethod, "cod"), eq(orders.paymentStatus, "PAID")),
  ];
  if (range.fromDate) orderFilters.push(gte(orders.merchantStatusUpdatedAt, range.fromDate));
  if (range.toExclusive) orderFilters.push(lt(orders.merchantStatusUpdatedAt, range.toExclusive));

  // A payment's effective settlement time is the verified capture, falling back
  // to the last provider update for legacy rows with no capturedAt stamp.
  const paidAt = sql`coalesce(${marketplacePayments.capturedAt}, ${marketplacePayments.updatedAt})`;
  const gross = sql`greatest(coalesce(${marketplacePayments.amountCents}, 0), 0)`;
  const refund = sql`least(greatest(coalesce(${marketplacePayments.refundedAmountCents}, 0), 0), ${gross})`;
  const commission = sql`greatest(coalesce(${orders.platformFeeCents}, 0), 0)`;
  const paymentFilters = [
    eq(marketplacePayments.restaurantId, restaurantId),
    eq(marketplacePayments.signatureVerified, true),
    inArray(marketplacePayments.status, PAID_PAYMENT_STATUSES),
  ];
  if (range.fromDate) paymentFilters.push(gte(paidAt, range.fromDate));
  if (range.toExclusive) paymentFilters.push(lt(paidAt, range.toExclusive));

  const [[orderTotals], [paymentTotals]] = await Promise.all([
    db.select({
      grossSales: sql<number>`coalesce(sum(${orders.totalCents}), 0)::bigint`.mapWith(Number),
      completedOrders: sql<number>`count(*)::int`,
    }).from(orders).where(and(...orderFilters)),
    db.select({
      netPaid: sql<number>`coalesce(sum(${gross} - ${refund} - ${commission}), 0)::bigint`.mapWith(Number),
      paidSettlements: sql<number>`count(*)::int`,
    }).from(marketplacePayments)
      .innerJoin(
        orders,
        and(
          eq(marketplacePayments.marketplaceOrderId, orders.id),
          eq(marketplacePayments.restaurantId, orders.restaurantId),
        ),
      )
      .where(and(...paymentFilters)),
  ]);

  return merchantRevenueDto(range, {
    grossSales: Number(orderTotals?.grossSales ?? 0),
    netPaid: Number(paymentTotals?.netPaid ?? 0),
    completedOrders: Number(orderTotals?.completedOrders ?? 0),
    paidSettlements: Number(paymentTotals?.paidSettlements ?? 0),
  });
}
