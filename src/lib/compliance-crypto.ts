import "server-only";

import { normalizePayoutInput, type MerchantPayoutInput } from "./merchant-compliance";
import { openWebhookSecret, sealWebhookSecret } from "./webhook-crypto";

/**
 * Payout destinations are financial data: the raw UPI ID / account number is
 * sealed with the same AES-256-GCM envelope already used for integration
 * secrets, so the database only ever holds ciphertext. The Merchant App gets
 * a masked label back and never receives these values.
 */
export function sealPayoutDestination(input: MerchantPayoutInput): string {
  return sealWebhookSecret(JSON.stringify({ version: 1, ...input }));
}

/** For future Marketplace-owned payout processing; not used by the read API. */
export function openPayoutDestination(envelope: string): MerchantPayoutInput {
  const parsed: unknown = JSON.parse(openWebhookSecret(envelope));
  return normalizePayoutInput(parsed);
}
