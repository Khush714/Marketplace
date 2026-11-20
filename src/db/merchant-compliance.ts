import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { marketplacePayments, merchantPayoutAccounts, orders } from "@/db/schema";
import { sealPayoutDestination } from "@/lib/compliance-crypto";
import {
  maskPayout,
  MERCHANT_INVOICE_LIMIT,
  payoutDto,
  toComplianceInvoice,
  type MerchantComplianceInvoice,
  type MerchantPayoutDto,
  type MerchantPayoutInput,
} from "@/lib/merchant-compliance";
import type { MerchantRevenueRange } from "@/lib/merchant-revenue";
import { toMerchantSettlement } from "@/lib/merchant-settlements";

/** Only real captures and reversals become invoice records; never unpaid intents. */
const INVOICE_PAYMENT_STATUSES = [
  "PAID", "CAPTURED", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUNDED",
];

export async function getPayoutAccount(restaurantId: number) {
  const rows = await db
    .select()
    .from(merchantPayoutAccounts)
    .where(eq(merchantPayoutAccounts.restaurantId, restaurantId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert one payout destination per listing. The reference is generated on the
 * first save and deliberately retained on updates so the Merchant mirror keeps
 * the same external identity.
 */
export async function savePayoutAccount(
  restaurantId: number,
  input: MerchantPayoutInput,
): Promise<MerchantPayoutDto> {
  const encryptedDestination = sealPayoutDestination(input);
  const maskedLabel = maskPayout(input);
  const now = new Date();
  const [row] = await db
    .insert(merchantPayoutAccounts)
    .values({
      restaurantId,
      method: input.method,
      encryptedDestination,
      maskedLabel,
      reference: `po_${randomBytes(12).toString("hex")}`,
      status: "configured",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: merchantPayoutAccounts.restaurantId,
      set: { method: input.method, encryptedDestination, maskedLabel, status: "configured", updatedAt: now },
    })
    .returning();
  return payoutDto(row);
}

function withinRange(range: MerchantRevenueRange) {
  if (!range.fromDate || !range.toExclusive) return undefined;
  const issuedAt = marketplacePayments.capturedAt;
  return or(
    and(isNotNull(issuedAt), gte(issuedAt, range.fromDate), lt(issuedAt, range.toExclusive)),
    and(
      isNull(issuedAt),
      gte(marketplacePayments.updatedAt, range.fromDate),
      lt(marketplacePayments.updatedAt, range.toExclusive),
    ),
  );
}

/**
 * Invoice feed derived from signature-verified payments for one listing. Tenant
 * scope is always the paired restaurant from the bearer token, never a query
 * parameter. Kept bounded at the Merchant app's 500-row ceiling.
 */
export async function listComplianceInvoices(
  restaurantId: number,
  range: MerchantRevenueRange,
): Promise<MerchantComplianceInvoice[]> {
  const rows = await db
    .select({ payment: marketplacePayments, order: orders })
    .from(marketplacePayments)
    .innerJoin(orders, eq(marketplacePayments.marketplaceOrderId, orders.id))
    .where(and(
      eq(marketplacePayments.restaurantId, restaurantId),
      eq(orders.restaurantId, restaurantId),
      eq(marketplacePayments.signatureVerified, true),
      inArray(marketplacePayments.status, INVOICE_PAYMENT_STATUSES),
      withinRange(range),
    ))
    .orderBy(desc(marketplacePayments.updatedAt))
    .limit(MERCHANT_INVOICE_LIMIT);

  return rows.map(({ payment, order }) => {
    const settlement = toMerchantSettlement({
      paymentReference: payment.paymentReference,
      providerPaymentId: payment.providerPaymentId,
      currency: payment.currency,
      status: payment.status,
      signatureVerified: payment.signatureVerified,
      amountCents: payment.amountCents,
      refundedAmountCents: payment.refundedAmountCents,
      capturedAt: payment.capturedAt,
      updatedAt: payment.updatedAt,
      order: { id: order.id, code: order.code, platformFeeCents: order.platformFeeCents },
    });
    return toComplianceInvoice({
      paymentReference: payment.paymentReference,
      currency: payment.currency,
      settlementStatus: settlement.status,
      netPaise: settlement.netPaise,
      orderCode: order.code,
      customerName: order.customerName,
      issuedAt: payment.capturedAt ?? payment.updatedAt,
      updatedAt: payment.updatedAt,
    });
  });
}
