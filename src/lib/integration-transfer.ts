/**
 * Ownership transfer for a POS identity (`restaurants.marketplace_id`).
 *
 * `marketplace_id` is UNIQUE. When a POS reconnects under a new listing while
 * its id is still held elsewhere, `syncMarketplaceId` raises
 * `MarketplaceIdTakenError` — a correct refusal, but it fires AFTER the POS has
 * redeemed its single-use connection code, so the operator is left with a burned
 * code and no way forward. That refusal is what this module makes recoverable:
 * the losing listing records a request, ops decides, and approval moves the id.
 *
 * Deliberately pure. The checks decide whether a move is still safe, and getting
 * one wrong silently unlinks a live restaurant or hands an identity to the wrong
 * listing — so they are separated from the SQL that performs the writes and
 * exercised directly in tests/integration-transfer.test.ts. `queries.ts` runs
 * this, then executes the returned plan in one transaction.
 */

import { notInArray } from "drizzle-orm";
import { orders } from "@/db/schema";
import { TERMINAL_STATUSES } from "@/integrations/pos/order-status";

/**
 * Orders still mid-flight: any lifecycle status the canonical vocabulary does
 * not consider terminal.
 *
 * Exported from the pure module rather than declared inline in `queries.ts` so
 * the count it feeds can be asserted on directly (see
 * tests/integration-transfer-sql.test.ts) — the previous inline version emitted
 * a statement Postgres rejected outright.
 *
 * Built with `notInArray` so the terminal set is derived from `TERMINAL_STATUSES`
 * and bound as parameters, never spliced in as string literals: adding a
 * terminal status cannot leave these counts quietly wrong, and no status value
 * can reach the statement as SQL.
 */
export const OPEN_ORDER_PREDICATE = notInArray(orders.integrationStatus, [...TERMINAL_STATUSES]);

/** What the approval path found in the database at decision time. */
export interface TransferRequestRow {
  id: number;
  requestedByRestaurantId: number;
  previousRestaurantId: number;
  marketplaceId: string;
  status: string;
}

export interface TransferStateSnapshot {
  /** The request being decided. */
  request: TransferRequestRow;
  /** Who holds `request.marketplaceId` right now, or null if nobody does. */
  currentHolderId: number | null;
  /** The requester's own `marketplace_id` right now. */
  requesterMarketplaceId: string | null;
  /** The requester's integration record, if any. */
  requesterRecord: { status: string; posRestaurantId: string | null } | null;
  /** The current holder's integration record, if any. */
  holderRecord: { status: string; posRestaurantId: string | null } | null;
  /**
   * Counts on the listing losing the id, so ops can see what approval breaks
   * before agreeing to it: `orders` is lifetime order volume, `openOrders` only
   * the ones still mid-flight.
   */
  holderStats: { orders: number; openOrders: number };
}

export type TransferRefusalCode =
  | "TRANSFER_NOT_PENDING"
  | "ALREADY_GRANTED"
  | "IDENTITY_UNCLAIMED"
  | "HOLDER_CHANGED";

export interface TransferRefusal {
  ok: false;
  code: TransferRefusalCode;
  error: string;
}

/** The writes approval must perform, in order, inside one transaction. */
export interface TransferPlan {
  ok: true;
  grantMarketplaceIdTo: number;
  /** Listing to disconnect: the id leaves it, so its record must not stay live. */
  releaseFromRestaurantId: number;
  marketplaceId: string;
  /**
   * Set on the losing listing's record so the ops console explains why it went
   * dark instead of showing a bare "Disconnected".
   */
  releaseReason: string;
  /**
   * Non-blocking hazards worth surfacing to the operator. Approval is still
   * allowed: a listing holding a dead identity with live order history is
   * exactly the case this feature exists for, and refusing would push it back
   * to hand-editing the database. The decision stays ops'.
   */
  warnings: string[];
}

export type TransferDecision = TransferPlan | TransferRefusal;

function refuse(code: TransferRefusalCode, error: string): TransferRefusal {
  return { ok: false, code, error };
}

/**
 * Decide whether a pending transfer can be approved, and produce the writes.
 *
 * Every refusal is a *stale* condition rather than a permission problem: by the
 * time ops clicks, the holder may have moved on or reconnected on its own. They
 * are reported distinctly so the console can say "this ask is out of date"
 * instead of implying the move was refused on the merits.
 */
export function planTransferApproval(state: TransferStateSnapshot): TransferDecision {
  const { request, currentHolderId, requesterMarketplaceId, requesterRecord, holderRecord, holderStats } =
    state;

  if (request.status !== "pending") {
    return refuse(
      "TRANSFER_NOT_PENDING",
      `This request was already ${request.status}. Refresh the queue.`,
    );
  }

  // Nothing to transfer to. Usually the holder disconnected, which nulls its
  // marketplace_id.
  if (currentHolderId === null) {
    return refuse(
      "IDENTITY_UNCLAIMED",
      "That POS identity is no longer held by any listing. Ask the restaurant to reconnect from the POS instead — it will claim cleanly now.",
    );
  }

  if (currentHolderId !== request.previousRestaurantId) {
    return refuse(
      "HOLDER_CHANGED",
      `The identity now belongs to a different listing (id ${currentHolderId}) than the one this request expected. Reject it and ask the restaurant to reconnect from the POS.`,
    );
  }

  if (requesterMarketplaceId === request.marketplaceId) {
    // The requester already holds it — most likely it reconnected successfully
    // after this request was raised. Reporting success is honest.
    return refuse("ALREADY_GRANTED", "This listing already holds that identity.");
  }

  const warnings: string[] = [];

  if (holderRecord?.status === "active") {
    warnings.push(
      "The listing losing this identity is still ACTIVE — approving closes its checkout immediately.",
    );
  }
  if (holderStats.openOrders > 0) {
    warnings.push(
      `${holderStats.openOrders} order${holderStats.openOrders === 1 ? " is" : "s are"} still mid-flight on the listing losing this identity. Its order-status webhooks will start failing.`,
    );
  }
  if (holderStats.orders > 0) {
    warnings.push(
      `${holderStats.orders} lifetime order${holderStats.orders === 1 ? "" : "s"} reference the listing losing this identity. History is preserved; new webhooks are not.`,
    );
  }
  if (holderRecord && holderRecord.posRestaurantId && holderRecord.posRestaurantId !== request.marketplaceId) {
    warnings.push(
      `The losing listing's record points at a different POS id (${holderRecord.posRestaurantId}), so it was already stale.`,
    );
  }
  if (requesterRecord && requesterRecord.status === "active") {
    warnings.push(
      "The requesting listing is already ACTIVE on another identity; this move will replace it.",
    );
  }

  return {
    ok: true,
    grantMarketplaceIdTo: request.requestedByRestaurantId,
    releaseFromRestaurantId: currentHolderId,
    marketplaceId: request.marketplaceId,
    releaseReason: `Identity moved to listing ${request.requestedByRestaurantId} by ops transfer`,
    warnings,
  };
}

/**
 * Whether the requester's connection record should go live as part of approval.
 *
 * Mirrors the rule in POST /api/partner/integrations: a record is only ACTIVE
 * once it has both an external id and a sealed webhook secret, because the
 * ordering gate and the delivery journal key off status alone. Approval moves
 * the id but does not mint secrets, so a record still missing its secret stays
 * pending rather than opening checkout for orders that can never be signed.
 */
export function shouldActivateOnApproval(record: {
  status: string;
  posRestaurantId: string | null;
  hasWebhookSecret: boolean;
}): boolean {
  return record.status !== "disabled" && !!record.posRestaurantId && record.hasWebhookSecret;
}

/** Shape returned to the partner so the UI can explain the conflict in words. */
export interface TransferConflictView {
  /** The listing that holds the identity today. */
  heldBy: { id: number; name: string; slug: string } | null;
  /** Set once a request exists, so the UI can stop offering the button. */
  request: { id: number; status: string; requestedAt: string } | null;
}

export function buildTransferConflictView(input: {
  holder: { id: number; name: string; slug: string } | null;
  request: { id: number; status: string; requestedAt: string } | null;
}): TransferConflictView {
  return {
    heldBy: input.holder,
    request: input.request,
  };
}
