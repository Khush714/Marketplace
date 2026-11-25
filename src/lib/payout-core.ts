import { createHash } from "node:crypto";

/**
 * Pure policy for Marketplace-owned restaurant payouts. No DB, network, secrets
 * or server-only state. Money is integer paise and every rule here is replayable
 * from a settlement snapshot, so a preview can be revalidated before approval.
 */

export const PAYOUT_CYCLES = ["weekly", "fortnightly", "monthly"] as const;
export type PayoutCycle = (typeof PAYOUT_CYCLES)[number];

export const PAYOUT_BATCH_STATUSES = [
  "PREVIEW",
  "APPROVED",
  "PROCESSING",
  "PAID",
  "FAILED",
  "CANCELLED",
] as const;
export type PayoutBatchStatus = (typeof PAYOUT_BATCH_STATUSES)[number];

const DAY_MS = 86_400_000;
const FORTNIGHT_ANCHOR_MS = Date.UTC(2026, 0, 5);

export class PayoutInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutInputError";
  }
}

/** The batch exists but its money snapshot changed, or its key is already used. */
export class PayoutConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutConflictError";
  }
}

export class PayoutNotFoundError extends Error {
  constructor(message = "Payout batch not found.") {
    super(message);
    this.name = "PayoutNotFoundError";
  }
}

export function normalizePayoutCycle(value: unknown): PayoutCycle {
  if (typeof value !== "string") throw new PayoutInputError("Choose a payout cycle.");
  const cycle = value.trim().toLowerCase();
  if (!PAYOUT_CYCLES.includes(cycle as PayoutCycle)) {
    throw new PayoutInputError("Unsupported payout cycle.");
  }
  return cycle as PayoutCycle;
}

export function normalizePayoutEnabled(value: unknown, fallback = true): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new PayoutInputError("enabled must be true or false.");
  return value;
}

const PAYOUT_REFERENCE = /^pb_[a-f0-9]{24}$/;
const PAYOUT_CHECKSUM = /^[a-f0-9]{32}$/;

export function normalizePayoutReference(value: unknown): string {
  if (typeof value !== "string" || !PAYOUT_REFERENCE.test(value.trim().toLowerCase())) {
    throw new PayoutInputError("Invalid payout reference.");
  }
  return value.trim().toLowerCase();
}

export function normalizePayoutChecksum(value: unknown): string {
  if (typeof value !== "string" || !PAYOUT_CHECKSUM.test(value.trim().toLowerCase())) {
    throw new PayoutInputError("Invalid payout checksum.");
  }
  return value.trim().toLowerCase();
}

export type PayoutWindow = {
  cycle: PayoutCycle;
  periodStart: Date;
  periodEnd: Date;
  idempotencyKey: string;
};

function startOfUtcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function currentMonday(value: Date): number {
  const start = startOfUtcDay(value);
  const day = new Date(start).getUTCDay();
  return start - ((day + 6) % 7) * DAY_MS;
}

/** The most recent fully closed billing window for this cycle. */
export function payoutCycleWindow(cycle: PayoutCycle, now = new Date()): PayoutWindow {
  let periodStart: number;
  let periodEnd: number;

  if (cycle === "weekly") {
    periodEnd = currentMonday(now);
    periodStart = periodEnd - 7 * DAY_MS;
  } else if (cycle === "fortnightly") {
    const monday = currentMonday(now);
    const index = Math.floor((monday - FORTNIGHT_ANCHOR_MS) / (14 * DAY_MS));
    periodEnd = FORTNIGHT_ANCHOR_MS + index * 14 * DAY_MS;
    periodStart = periodEnd - 14 * DAY_MS;
  } else {
    periodEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    periodStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  }

  const start = new Date(periodStart);
  return {
    cycle,
    periodStart: start,
    periodEnd: new Date(periodEnd),
    idempotencyKey: `${cycle}:${start.toISOString().slice(0, 10)}`,
  };
}

export type PayoutSettlementInput = {
  externalId: string;
  marketplaceOrderId: string;
  currency: string;
  status: string;
  signatureVerified: boolean;
  grossPaise: number;
  commissionPaise: number;
  refundPaise: number;
  adjustmentPaise: number;
  netPaise: number;
  capturedAt: Date | null;
};

export type PayoutPreviewLine = {
  settlementExternalId: string;
  marketplaceOrderId: string;
  grossPaise: number;
  commissionPaise: number;
  refundPaise: number;
  adjustmentPaise: number;
  netPaise: number;
  currency: string;
  capturedAt: Date;
};

export type PayoutExclusion = { settlementExternalId: string; reason: string };

export type PayoutTotals = {
  grossPaise: number;
  commissionPaise: number;
  refundPaise: number;
  adjustmentPaise: number;
  netPaise: number;
  lineCount: number;
};

export type PayoutPreview = {
  lines: PayoutPreviewLine[];
  totals: PayoutTotals;
  exclusions: PayoutExclusion[];
  checksum: string;
};

const PAID_STATUSES = new Set(["paid", "PAID", "CAPTURED", "PARTIALLY_REFUNDED", "REFUND_PENDING"]);

function isSafePaise(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

/** Deterministic fingerprint of exactly which settlements the batch would pay. */
export function payoutChecksum(lines: readonly Pick<PayoutPreviewLine, "settlementExternalId" | "netPaise">[]): string {
  const fingerprint = lines
    .map((line) => `${line.settlementExternalId}:${line.netPaise}`)
    .sort()
    .join("|");
  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);
}

export function buildPayoutPreview(input: {
  window: Pick<PayoutWindow, "periodStart" | "periodEnd">;
  settlements: readonly PayoutSettlementInput[];
  alreadyAllocated?: ReadonlySet<string>;
}): PayoutPreview {
  const { periodStart, periodEnd } = input.window;
  if (!(periodStart.getTime() < periodEnd.getTime())) {
    throw new PayoutInputError("Payout period is invalid.");
  }
  const allocated = input.alreadyAllocated ?? new Set<string>();
  const lines: PayoutPreviewLine[] = [];
  const exclusions: PayoutExclusion[] = [];
  const totals: PayoutTotals = {
    grossPaise: 0,
    commissionPaise: 0,
    refundPaise: 0,
    adjustmentPaise: 0,
    netPaise: 0,
    lineCount: 0,
  };

  for (const settlement of input.settlements) {
    const id = settlement.externalId.slice(0, 128);
    const exclude = (reason: string) => exclusions.push({ settlementExternalId: id, reason });

    if (allocated.has(id)) { exclude("already_allocated"); continue; }
    if (!PAID_STATUSES.has(settlement.status)) { exclude("not_paid"); continue; }
    if (!settlement.signatureVerified) { exclude("unverified"); continue; }
    if (settlement.currency.trim().toUpperCase() !== "INR") { exclude("wrong_currency"); continue; }
    if (!settlement.capturedAt) { exclude("missing_capture_time"); continue; }
    if (settlement.capturedAt < periodStart || settlement.capturedAt >= periodEnd) {
      exclude("outside_period");
      continue;
    }
    if (![settlement.grossPaise, settlement.commissionPaise, settlement.refundPaise, settlement.adjustmentPaise, settlement.netPaise].every(isSafePaise)) {
      exclude("invalid_amount");
      continue;
    }
    if (settlement.grossPaise - settlement.commissionPaise - settlement.refundPaise + settlement.adjustmentPaise !== settlement.netPaise) {
      exclude("amount_mismatch");
      continue;
    }
    if (settlement.netPaise <= 0) { exclude("non_positive_net"); continue; }

    const line: PayoutPreviewLine = {
      settlementExternalId: id,
      marketplaceOrderId: settlement.marketplaceOrderId.slice(0, 128),
      grossPaise: settlement.grossPaise,
      commissionPaise: settlement.commissionPaise,
      refundPaise: settlement.refundPaise,
      adjustmentPaise: settlement.adjustmentPaise,
      netPaise: settlement.netPaise,
      currency: "INR",
      capturedAt: settlement.capturedAt,
    };
    lines.push(line);
    totals.grossPaise += line.grossPaise;
    totals.commissionPaise += line.commissionPaise;
    totals.refundPaise += line.refundPaise;
    totals.adjustmentPaise += line.adjustmentPaise;
    totals.netPaise += line.netPaise;
    totals.lineCount += 1;
  }

  lines.sort((a, b) => a.settlementExternalId.localeCompare(b.settlementExternalId));
  exclusions.sort((a, b) => a.settlementExternalId.localeCompare(b.settlementExternalId));
  return { lines, totals, exclusions, checksum: payoutChecksum(lines) };
}

const BATCH_TRANSITIONS: Record<PayoutBatchStatus, readonly PayoutBatchStatus[]> = {
  PREVIEW: ["APPROVED", "CANCELLED"],
  APPROVED: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["PAID", "FAILED"],
  PAID: [],
  FAILED: ["PROCESSING"],
  CANCELLED: [],
};

export function canAdvancePayoutBatch(from: PayoutBatchStatus, to: PayoutBatchStatus): boolean {
  return BATCH_TRANSITIONS[from].includes(to);
}

export function assertPayoutBatchTransition(from: PayoutBatchStatus, to: PayoutBatchStatus): void {
  if (!canAdvancePayoutBatch(from, to)) throw new PayoutInputError(`Cannot move payout batch ${from} → ${to}.`);
}
