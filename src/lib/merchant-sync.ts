/**
 * Pure change-signal versioning for the Marketplace ↔ Merchant App link.
 *
 * The Merchant App must not have to download the whole order inbox to find out
 * that nothing changed. This module turns a handful of authoritative aggregates
 * into two opaque tokens that the browser compares for *inequality* only:
 *
 * - `orders` changes when an order is created, becomes visible to the merchant,
 *   transitions status, or is edited (fulfilment, address, prep time).
 * - `feedback` changes when a customer reviews an order or the merchant replies.
 *
 * Keeping this pure lets the same rules be tested without a database. The
 * database reads that build the snapshot live in `src/db/merchant-orders.ts`.
 */

export interface MerchantSyncSnapshot {
  /** Visible merchant-managed orders for the restaurant. */
  count: number;
  /** Subset of those already paid (visibility can flip when payment lands). */
  paidCount: number;
  /** Latest order creation, as an opaque database timestamp string. */
  latestCreated: string | null;
  /** Latest merchant lifecycle transition. */
  latestStatus: string | null;
  /** Latest row id in the merchant order event ledger. */
  latestEvent: string | null;
  /** Latest customer review timestamp. */
  latestFeedback: string | null;
  /** Latest merchant reply timestamp. */
  latestReply: string | null;
}

export interface MerchantSyncVersion {
  orders: string;
  feedback: string;
}

const token = (value: string | null) => value ?? "-";

/**
 * Compose the comparison tokens. `latestEvent` is the catch-all: every status
 * change, fulfilment edit, review and reply appends to `merchant_order_events`,
 * so a change that does not move a timestamp still moves this token.
 */
export function merchantSyncVersion(snapshot: MerchantSyncSnapshot): MerchantSyncVersion {
  return {
    orders: [
      snapshot.count,
      snapshot.paidCount,
      token(snapshot.latestCreated),
      token(snapshot.latestStatus),
      token(snapshot.latestEvent),
    ].join("|"),
    feedback: [token(snapshot.latestFeedback), token(snapshot.latestReply)].join("|"),
  };
}
