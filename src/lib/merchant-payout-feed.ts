import type { PayoutBatchStatus } from "./payout-core";

/**
 * DTO boundary for the Merchant App payout mirror. Only orders that actually
 * moved into the disbursement pipeline are exposed; previews and cancellations
 * are deliberately absent so Merchant can never present them as bank payouts.
 */

export type MerchantPayoutFeedBatch = {
  reference: string;
  methodLabel: string;
  status: string;
  amountPaise: number;
  initiatedAt: string | null;
  completedAt: string | null;
  allocations: { settlementExternalId: string; amountPaise: number }[];
};

const FEED_STATUSES: Partial<Record<PayoutBatchStatus, string>> = {
  APPROVED: "scheduled",
  PROCESSING: "processing",
  PAID: "paid",
  FAILED: "failed",
};

export function toMerchantPayoutBatch(input: {
  reference: string;
  status: PayoutBatchStatus;
  netPaise: number;
  approvedAt: Date | null;
  createdAt: Date;
  paidAt: Date | null;
  maskedLabel: string;
  allocations: readonly { settlementExternalId: string; netPaise: number }[];
}): MerchantPayoutFeedBatch | null {
  const status = FEED_STATUSES[input.status];
  if (!status || input.netPaise <= 0) return null;
  return {
    reference: input.reference.slice(0, 128),
    methodLabel: input.maskedLabel.slice(0, 120) || "Bank/UPI",
    status,
    amountPaise: input.netPaise,
    initiatedAt: (input.approvedAt ?? input.createdAt).toISOString(),
    completedAt: input.paidAt?.toISOString() ?? null,
    allocations: input.allocations.map((line) => ({
      settlementExternalId: line.settlementExternalId.slice(0, 128),
      amountPaise: line.netPaise,
    })),
  };
}

export function emptyMerchantPayoutFeed(): { ok: true; available: false; payouts: []; message: string } {
  return {
    ok: true,
    available: false,
    payouts: [],
    message: "Marketplace has no approved payouts for this outlet yet.",
  };
}
