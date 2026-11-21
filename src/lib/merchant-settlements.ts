/**
 * Pure projection from Marketplace payment records to the settlement feed the
 * Merchant App consumes. Marketplace has no separate payout ledger: gross and
 * refunds come from the signature-verified payment row, and commission comes
 * from the platform-fee snapshot stored on the order. Kept free of server-only
 * imports so the money math and status mapping can be tested directly.
 */

/** One page holds at most 200 rows; ten pages keep a manual Merchant sync bounded. */
export const MERCHANT_SETTLEMENT_PAGE_SIZE = 200;
export const MERCHANT_SETTLEMENT_MAX_PAGE = 10;

/** Unknown or hostile page values collapse to page 1 before any database work. */
export function normalizeMerchantSettlementPage(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MERCHANT_SETTLEMENT_MAX_PAGE);
}

export type MerchantSettlementStatus = "pending" | "paid" | "failed" | "reversed";

export type MerchantSettlementRecord = {
  externalId: string;
  marketplaceOrderId: string;
  orderNumber: number;
  grossPaise: number;
  commissionPaise: number;
  refundPaise: number;
  adjustmentPaise: number;
  netPaise: number;
  currency: string;
  status: MerchantSettlementStatus;
  reference: string;
  paidAt: string | null;
  updatedAt: string;
};

export type MerchantSettlementSource = {
  paymentReference: string;
  providerPaymentId: string | null;
  currency: string;
  status: string;
  signatureVerified: boolean;
  amountCents: number;
  refundedAmountCents: number;
  capturedAt: Date | null;
  updatedAt: Date;
  order: {
    id: number;
    code: string;
    platformFeeCents: number;
  };
};

const PAID = new Set(["PAID", "CAPTURED", "PARTIALLY_REFUNDED", "REFUND_PENDING"]);
const REVERSED = new Set(["REFUNDED"]);
const FAILED = new Set(["FAILED", "PAYMENT_CANCELLED", "CANCELLED", "EXPIRED"]);

export function merchantSettlementStatus(status: string): MerchantSettlementStatus {
  if (PAID.has(status)) return "paid";
  if (REVERSED.has(status)) return "reversed";
  if (FAILED.has(status)) return "failed";
  return "pending";
}

/** The Marketplace payment row is the money source; the order supplies the commission. */
export function toMerchantSettlement(source: MerchantSettlementSource): MerchantSettlementRecord {
  const mappedStatus = merchantSettlementStatus(source.status);
  // Only provider-verified captures may appear as confirmed money in Merchant.
  const status = !source.signatureVerified && mappedStatus === "paid" ? "pending" : mappedStatus;
  const grossPaise = Math.max(0, Math.trunc(source.amountCents));
  const commissionPaise = Math.max(0, Math.trunc(source.order.platformFeeCents));
  const refundPaise = Math.min(grossPaise, Math.max(0, Math.trunc(source.refundedAmountCents)));
  const adjustmentPaise = 0;
  const netPaise = grossPaise - commissionPaise - refundPaise + adjustmentPaise;

  return {
    externalId: `payment:${source.paymentReference}`.slice(0, 128),
    marketplaceOrderId: source.order.code.slice(0, 128),
    orderNumber: source.order.id,
    grossPaise,
    commissionPaise,
    refundPaise,
    adjustmentPaise,
    netPaise,
    currency: source.currency.trim().toUpperCase() || "INR",
    status,
    reference: (source.providerPaymentId ?? source.paymentReference).slice(0, 200),
    paidAt: status === "paid" ? (source.capturedAt ?? source.updatedAt).toISOString() : null,
    updatedAt: source.updatedAt.toISOString(),
  };
}
